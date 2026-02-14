require('dotenv').config();
const express = require('express');
const http = require('http');
const { format, subDays } = require('date-fns');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');

// WebSocket для real-time обновлений
const { initWebSocket, getConnectedClients } = require('./websocket');

// Используем оптимизированный модуль для работы с БД (аналог PDO в PHP)
// Кэширует prepared statements и оптимизирует запросы
const { pool, execute: dbExecute, getPoolStats } = require('./db-optimizer');
const { calculateCallbackStats } = require('./stats-calculator');

// Модуль проверки перезвонов (единая логика для аналитики и рейтинга)
const { checkCallbacksBatch, checkCallbacksBatchInbound } = require('./callback-checker');

// Модуль параллельных запросов для максимального использования CPU MySQL
const { 
  getQueueCallsParallel, 
  getInboundCallsParallel, 
  getOutboundCallsParallel,
  PARALLEL_CONFIG 
} = require('./db-parallel');

// Модуль оптимизированных запросов для больших данных в MariaDB
const {
  getQueueCallsOptimized,
  getInboundCallsOptimized
} = require('./db-large-data');

// Ультра-оптимизированные запросы (самые быстрые) - все используют стратегию 2 запроса + Map
const {
  getQueueCallsUltraFast,
  getInboundCallsUltraFast,
  getInboundCallsByQueueUltraFast,
  getOutboundCallsUltraFast,
  getOutboundQueueCallsUltraFast
} = require('./db-optimized-queue');

// Базовые функции получения звонков (fallback, когда USE_ULTRA_FAST_QUERIES = false)
const {
  getQueueCalls,
  getInboundCalls,
  getOutboundCalls,
  getOutboundQueueCalls
} = require('./db-calls');

// Модуль рейтингов очередей
const {
  getQueueRankings,
  getTopQueues
} = require('./queue-rankings');

// SQLite модуль для настроек и email_reports
const settingsDb = require('./settings-db');

// Роутеры
const { settingsRouter, emailReportsRouter, rankingsRouter, healthRouter, comparisonRouter, viewsRouter, initViewsRouter } = require('./routes');

// Swagger документация
const { setupSwagger } = require('./swagger');

// Prometheus метрики
const { metricsMiddleware, metricsRouter, setActiveQueues } = require('./metrics');

// i18n (многоязычность)
const { i18nMiddleware, i18nRouter } = require('./i18n');

// Общий модуль часовых поясов (DST-safe)
const { getTimezone, getTimezoneOffset, formatNowLocal, dayBoundsToUTC } = require('./timezone-helper');

// Флаги использования оптимизаций
const USE_ULTRA_FAST_QUERIES = process.env.USE_ULTRA_FAST_QUERIES !== 'false'; // По умолчанию включено (самый быстрый)
const USE_PARALLEL_QUERIES = process.env.USE_PARALLEL_QUERIES !== 'false';
const USE_LARGE_DATA_OPTIMIZATION = process.env.USE_LARGE_DATA_OPTIMIZATION === 'true';

// === ФИЛЬТРАЦИЯ ПО РАБОЧИМ ЧАСАМ ===
/**
 * Получить настройки рабочих часов
 * @returns {Object} { enabled: boolean, startHour: number, startMinute: number, endHour: number, endMinute: number }
 */
function getWorkingHoursConfig() {
  const enabled = process.env.WORK_HOURS_ENABLED === 'true';
  const startTime = process.env.WORK_HOURS_START || '07:00';
  const endTime = process.env.WORK_HOURS_END || '23:59';
  
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  
  return {
    enabled,
    startHour: startHour || 7,
    startMinute: startMinute || 0,
    endHour: endHour || 23,
    endMinute: endMinute || 59
  };
}

/**
 * Фильтровать звонки по рабочим часам
 * @param {Array} calls - Массив звонков
 * @returns {Array} Отфильтрованные звонки
 */
function filterByWorkingHours(calls) {
  const config = getWorkingHoursConfig();
  
  if (!config.enabled) {
    return calls; // Фильтр выключен, возвращаем все звонки
  }
  
  const startMinutes = config.startHour * 60 + config.startMinute;
  const endMinutes = config.endHour * 60 + config.endMinute;
  
  return calls.filter(call => {
    if (!call.startTime) return false;
    
    // Парсим время из startTime (формат: "YYYY-MM-DD HH:MM:SS" или Date)
    let hour, minute;
    
    if (typeof call.startTime === 'string') {
      const match = call.startTime.match(/(\d{2}):(\d{2})/);
      if (match) {
        hour = parseInt(match[1], 10);
        minute = parseInt(match[2], 10);
      } else {
        return true; // Не удалось распарсить - оставляем звонок
      }
    } else if (call.startTime instanceof Date) {
      hour = call.startTime.getHours();
      minute = call.startTime.getMinutes();
    } else {
      return true; // Неизвестный формат - оставляем звонок
    }
    
    const callMinutes = hour * 60 + minute;
    return callMinutes >= startMinutes && callMinutes <= endMinutes;
  });
}

const app = express();
const PORT = process.env.PORT || 3000;

// Глобальная переменная для отслеживания готовности адаптера
let dbAdapterReady = false;
let dbAdapterInitPromise = null;

// Инициализация базы данных настроек и адаптера БД
// Эта функция должна быть вызвана СИНХРОННО до любых операций с БД
async function initializeDatabaseAdapter() {
  if (dbAdapterInitPromise) {
    return dbAdapterInitPromise;
  }
  
  dbAdapterInitPromise = (async () => {
    try {
      await settingsDb.initDatabase();
      
      // Загружаем настройки из базы данных
      const settings = settingsDb.getAllSettings();
      
      // Переопределяем переменные окружения значениями из базы (если они есть)
      for (const [key, value] of Object.entries(settings)) {
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
      
      logger.info('✅ Настройки загружены из базы данных');
      
      // Инициализируем адаптер БД с правильными настройками
      const { initAdapter } = require('./db-optimizer');
      const dbConfig = {
        host: settings.DB_HOST || process.env.DB_HOST || 'localhost',
        user: settings.DB_USER || process.env.DB_USER || 'freepbxuser',
        password: settings.DB_PASS || process.env.DB_PASS || '',
        database: settings.DB_NAME || process.env.DB_NAME || 'asterisk',
        adapter: settings.DB_ADAPTER || process.env.DB_ADAPTER || 'mysql2',
        connectionLimit: parseInt(settings.DB_CONNECTION_LIMIT || process.env.DB_CONNECTION_LIMIT || '20')
      };
      
      initAdapter(dbConfig);
      dbAdapterReady = true;
      logger.info('✅ Адаптер БД инициализирован с настройками из базы данных');
      
    } catch (err) {
      logger.error('❌ Ошибка инициализации базы данных настроек:', err);
      logger.info('⚠️  Используются настройки из .env файла');
      
      // Инициализируем адаптер с дефолтными настройками
      const { initAdapter } = require('./db-optimizer');
      initAdapter();
      dbAdapterReady = true;
    }
  })();
  
  return dbAdapterInitPromise;
}

// Конфигурация фильтрации звонков
const CALL_FILTER_CONFIG = {
  // Минимальная длина номера для исходящих звонков (по умолчанию 4)
  // Номера длиннее этого значения считаются исходящими
  outboundMinLength: parseInt(process.env.OUTBOUND_MIN_LENGTH) || 4
};

// Версия для cache busting статики (генерируется при старте сервера)
const STATIC_VERSION = Date.now().toString(36);

let availableQueues = [];
let queuesCacheTime = 0;
const QUEUES_CACHE_TTL = parseInt(process.env.QUEUES_CACHE_TTL) || 3600000; // 1 час по умолчанию
let queueNamesCache = {}; // Кэш названий очередей: { "1049": "Название очереди" }
let queueNamesCacheTime = 0;

// Rate Limiting для API
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 100, // 100 запросов на IP за 15 минут
  message: { success: false, error: 'Слишком много запросов, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false
});

// Middleware
app.use(compression()); // Сжатие gzip
app.use(metricsMiddleware); // Prometheus метрики HTTP
app.use(cookieParser()); // Парсинг cookies
app.use(i18nMiddleware); // i18n многоязычность
app.use('/api/', apiLimiter); // Rate limiting для API
app.set('view engine', 'ejs');
app.set('view cache', false); // Отключаем кэширование шаблонов
app.locals.staticVersion = STATIC_VERSION; // Доступен во всех EJS шаблонах
app.use(express.json()); // Для JSON запросов
app.use(express.urlencoded({ extended: true })); // Для form-data

// Кэширование статических ресурсов
app.use('/css', express.static('public/css', {
  maxAge: '1y',
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

app.use('/js', express.static('public/js', {
  maxAge: '1y',
  setHeaders: (res, path) => {
    if (path.endsWith('.js')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

app.use('/images', express.static('public/images', {
  maxAge: '1y',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
}));

// Другие статические файлы с меньшим кэшем
app.use(express.static('public', {
  maxAge: '1d'
}));

// Подключение роутеров
app.use('/api/settings', settingsRouter);
app.use('/api/email-reports', emailReportsRouter);
app.use('/api/health', healthRouter);
app.use('/api/comparison', comparisonRouter);
app.use('/api/i18n', i18nRouter);
app.use('/', rankingsRouter); // POST /rankings, POST /export-rankings-excel

// Swagger API документация
setupSwagger(app);

// Prometheus метрики endpoint
app.use('/api/metrics', metricsRouter);

// Функции помощники
const helpers = {
  translateStatus: (status) => {
    const statusMap = {
      'completed_by_caller': '<i class="bi bi-telephone-outbound-fill me-1"></i> Завершен клиентом',
      'completed_by_agent': '<i class="bi bi-telephone-inbound-fill me-1"></i> Завершен агентом',
      'abandoned': '<i class="bi bi-telephone-x-fill me-1"></i> Неотвечен'
    };
    return statusMap[status] || status;
  },
  calculateWaitTime: (call) => {
    if (!call.startTime) return '-';
    const endTime = call.connectTime || call.endTime;
    if (!endTime) return '-';
    
    try {
      // Парсим строки времени напрямую (формат: "YYYY-MM-DD HH:MM:SS")
      const parseTime = (timeStr) => {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const match = timeStr.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})/);
        if (!match) return null;
        const [, yr, mo, dy, hr, mi, sc] = match.map(Number);
        return new Date(yr, mo - 1, dy, hr, mi, sc).getTime();
      };
      
      const startMs = parseTime(call.startTime);
      const endMs = parseTime(endTime);
      
      if (startMs && endMs && endMs > startMs) {
        const diffSeconds = Math.round((endMs - startMs) / 1000);
        // Проверяем разумность значения (не больше 2 часов = 7200 секунд)
        if (diffSeconds >= 0 && diffSeconds <= 7200) {
          return diffSeconds;
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга дат
    }
    
    return '-';
  },
  formatDuration: (sec) => {
    if (!sec || isNaN(sec)) return '-';
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins} мин ${secs} сек`;
  },
  formatTime: (timeStr) => {
    if (!timeStr) return '-';
    // Данные в БД уже в локальном времени (Europe/Moscow)
    // Извлекаем время напрямую без преобразования таймзоны
    const str = timeStr.toString();
    // Если это Date объект, преобразуем в строку ISO
    if (timeStr instanceof Date) {
      // Получаем часы и минуты напрямую (без преобразования таймзоны)
      const hours = String(timeStr.getHours()).padStart(2, '0');
      const minutes = String(timeStr.getMinutes()).padStart(2, '0');
      return `${hours}:${minutes}`;
    }
    // Если строка формата "YYYY-MM-DD HH:MM:SS" или ISO
    const match = str.match(/(\d{2}):(\d{2})/);
    if (match) {
      return `${match[1]}:${match[2]}`;
    }
    // Fallback: пробуем через Date, но используем getHours/getMinutes без таймзоны
    try {
      const date = new Date(timeStr);
      if (!isNaN(date.getTime())) {
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
      }
    } catch (e) {
      logger.warn('[helpers.formatTime] Ошибка парсинга:', timeStr, e.message);
    }
    return '-';
  },
  formatShortDate: (dateStr) => {
    if (!dateStr) return '';
    // Данные в БД уже в локальном времени
    const str = dateStr.toString();
    // Если строка формата "YYYY-MM-DD..." 
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return `${match[3]}.${match[2]}`;
    }
    // Fallback
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        return `${day}.${month}`;
      }
    } catch (e) {
      logger.warn('[helpers.formatShortDate] Ошибка парсинга:', dateStr, e.message);
    }
    return '';
  },
  formatDateTime: (dateStr) => {
    if (!dateStr) return '-';
    // Данные в БД уже в локальном времени
    const str = dateStr.toString();
    // Если строка формата "YYYY-MM-DD HH:MM:SS"
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
    if (match) {
      return `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}`;
    }
    // Если это Date объект
    if (dateStr instanceof Date) {
      const day = String(dateStr.getDate()).padStart(2, '0');
      const month = String(dateStr.getMonth() + 1).padStart(2, '0');
      const year = dateStr.getFullYear();
      const hours = String(dateStr.getHours()).padStart(2, '0');
      const minutes = String(dateStr.getMinutes()).padStart(2, '0');
      return `${day}.${month}.${year}, ${hours}:${minutes}`;
    }
    // Fallback
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${day}.${month}.${year}, ${hours}:${minutes}`;
      }
    } catch (e) {
      logger.warn('[helpers.formatDateTime] Ошибка парсинга:', dateStr, e.message);
    }
    return '-';
  },
  getRecordingLink: (recordingFile) => {
    if (!recordingFile) return null;
    
    // Поддерживаем форматы: 
    // - in-...-YYYYMMDD-... (входящие)
    // - out-...-YYYYMMDD-... (исходящие)
    // - q-...-YYYYMMDD-... (записи из очередей, например q-1049-...-YYYYMMDD-...)
    
    // Ищем дату в формате YYYYMMDD (год начинается с 20, месяц 01-12, день 01-31)
    // Это более надежный способ, чем искать любые 8 цифр
    const dateMatch = recordingFile.match(/20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/);
    if (!dateMatch) return null;
    
    const datePart = dateMatch[0];
    const year = datePart.substring(0, 4);
    const month = datePart.substring(4, 6);
    const day = datePart.substring(6, 8);
    
    return `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
  },
  formatQueueName: (queueNumber) => {
    return formatQueueName(queueNumber);
  }
};

// Инициализация приложения
async function initializeApp() {
  // Убеждаемся, что адаптер БД инициализирован перед использованием
  if (!dbAdapterReady) {
    await initializeDatabaseAdapter();
  }
  
  logger.info('🔄 Загрузка кэша очередей...');
  await refreshQueuesCache();
  logger.info('🔄 Загрузка названий очередей...');
  await refreshQueueNamesCache();
  logger.info('✅ Кэши загружены, готов к работе');
  
  // Выводим статистику пула при старте
  if (process.env.DEBUG_DB === 'true') {
    logger.info('📊 Статистика пула соединений:', getPoolStats());
  }
}

// Функция обновления кэша очередей
async function refreshQueuesCache() {
  try {
    const [queues] = await dbExecute(`
      SELECT DISTINCT queuename 
      FROM asteriskcdrdb.queuelog 
      WHERE queuename IS NOT NULL AND queuename != 'NONE'
      ORDER BY queuename
    `);
    availableQueues = queues.map(q => q.queuename);
    queuesCacheTime = Date.now();
    logger.info('Загружено очередей:', availableQueues.length);
    setActiveQueues(availableQueues.length); // Обновляем Prometheus метрику
  } catch (err) {
    logger.error('Ошибка при загрузке очередей:', err);
  }
}

// Функция получения названий очередей из базы данных
async function refreshQueueNamesCache() {
  try {
    const [queueNames] = await dbExecute(`
      SELECT extension, descr 
      FROM asterisk.queues_config 
      WHERE extension IS NOT NULL AND extension != ''
    `);
    
    queueNamesCache = {};
    queueNames.forEach(q => {
      if (q.descr) {
        queueNamesCache[q.extension] = q.descr;
      }
    });
    queueNamesCacheTime = Date.now();
    
    if (process.env.DEBUG === 'true') {
      logger.info('Загружено названий очередей:', Object.keys(queueNamesCache).length);
    }
  } catch (err) {
    logger.error('Ошибка при загрузке названий очередей:', err);
    queueNamesCache = {};
  }
}

// Функция получения названия очереди (с кэшированием)
function getQueueName(queueNumber) {
  // Если кэш пуст и еще не инициализирован, пытаемся загрузить синхронно
  if (queueNamesCacheTime === 0 && Object.keys(queueNamesCache).length === 0) {
    // Кэш еще не загружен - возвращаем null, но запускаем загрузку
    // В продакшене это не должно происходить, так как initializeApp() загружает кэш до старта сервера
    refreshQueueNamesCache().catch(err => {
      logger.error('Ошибка при обновлении кэша названий очередей:', err);
    });
    return null;
  }
  
  const now = Date.now();
  if (now - queueNamesCacheTime > QUEUES_CACHE_TTL) {
    // Кэш устарел - обновляем асинхронно, но возвращаем текущее значение
    refreshQueueNamesCache().catch(err => {
      logger.error('Ошибка при обновлении кэша названий очередей:', err);
    });
  }
  
  return queueNamesCache[queueNumber] || null;
}

// Функция форматирования названия очереди: "1049 (Название очереди)" или просто "1049"
function formatQueueName(queueNumber) {
  const name = getQueueName(queueNumber);
  return name ? `${queueNumber} (${name})` : queueNumber;
}

// Функция получения списка очередей с кэшированием
function getAvailableQueues() {
  const now = Date.now();
  if (now - queuesCacheTime > QUEUES_CACHE_TTL) {
    // Асинхронно обновляем кэш, но возвращаем текущий список
    refreshQueuesCache().catch(err => {
      logger.error('Ошибка при обновлении кэша очередей:', err);
    });
  }
  return availableQueues;
}

// Функции getTimezone() и getTimezoneOffset() импортированы из timezone-helper.js

// API для проверки статуса системы (добавлен перед основными маршрутами)
app.get('/api/status', async (req, res) => {
  try {
    await dbExecute('SELECT 1 as test');
    
    const poolStats = getPoolStats();
    res.json({
      status: 'online',
      database: 'connected',
      pool: poolStats,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'offline',
      database: 'disconnected',
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Маршруты
// Функция получения параметров фильтров из query string
function getFilterParams(req) {
  const today = format(new Date(), 'yyyy-MM-dd');
  return {
    startDate: req.query.start_date || req.query.startDate || today,
    endDate: req.query.end_date || req.query.endDate || today,
    selectedQueue: req.query.queue_name || req.query.queue || ''
  };
}

// Инициализация viewsRouter с зависимостями
initViewsRouter({ getFilterParams, getAvailableQueues });

// GET страницы - см. routes/views.js
app.use('/', viewsRouter);

// ==========================================
// API для управления настройками и email - см. routes/settings.js и routes/email-reports.js
// ==========================================

// Маршрут для ручной отправки ежедневного отчета (для тестирования)
app.post('/api/send-daily-report', async (req, res) => {
  try {
    const { date, queue_name } = req.body;
    const reportDate = date || format(subDays(new Date(), 1), 'yyyy-MM-dd');
    
    const { generateQueueReport, sendQueueReport } = require('./email-service');
    
    const callFunctions = {
      getQueueCalls,
      getQueueCallsUltraFast,
      getQueueCallsOptimized,
      getQueueCallsParallel,
      getInboundCalls,
      getInboundCallsUltraFast,
      getInboundCallsByQueueUltraFast,
      getOutboundCalls,
      getOutboundCallsUltraFast,
      getOutboundQueueCallsUltraFast,
      checkCallbacksBatch,
      checkCallbacksBatchInbound,
      calculateStats
    };
    
    if (queue_name) {
      // Отправка отчета для конкретной очереди
      const { getPool } = require('./db-optimizer');
      const currentPool = getPool();
      
      // Получаем часовой пояс из настроек и конвертируем границы дня в UTC
      const timezone = getTimezone();
      const offsetHours = getTimezoneOffset(timezone);
      const startOfDayLocal = new Date(reportDate + 'T00:00:00');
      const endOfDayLocal = new Date(reportDate + 'T23:59:59');
      const startOfDayUTC = new Date(startOfDayLocal.getTime() - (offsetHours * 60 * 60 * 1000));
      const endOfDayUTC = new Date(endOfDayLocal.getTime() - (offsetHours * 60 * 60 * 1000));
      const startTimeUTC = format(startOfDayUTC, 'yyyy-MM-dd HH:mm:ss');
      const endTimeUTC = format(endOfDayUTC, 'yyyy-MM-dd HH:mm:ss');
      
      logger.info(`📧 Генерация отчета для очереди ${queue_name} за ${reportDate} (${timezone})...`);
      logger.info(`📧 Диапазон запроса в UTC: ${startTimeUTC} - ${endTimeUTC}`);
      const reportData = await generateQueueReport(currentPool, queue_name, reportDate, startTimeUTC, endTimeUTC, callFunctions);
      const result = await sendQueueReport(reportData, queue_name, currentPool);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: `Отчет для очереди ${queue_name} успешно отправлен`,
          date: reportDate,
          queue_name: queue_name,
          messageId: result.messageId
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: result.error || 'Ошибка отправки отчета'
        });
      }
    } else {
      // Отправка общего отчета (для всех очередей)
      const { generateDailyReport, sendDailyReport } = require('./email-service');
      logger.info(`📧 Генерация общего отчета за ${reportDate}...`);
      const reportData = await generateDailyReport(pool, reportDate, callFunctions);
      const result = await sendDailyReport(reportData);
      
      if (result.success) {
        res.json({ 
          success: true, 
          message: 'Общий отчет успешно отправлен',
          date: reportDate,
          messageId: result.messageId
        });
      } else {
        res.status(500).json({ 
          success: false, 
          error: result.error || 'Ошибка отправки отчета'
        });
      }
    }
  } catch (error) {
    logger.error('Ошибка при отправке отчета:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

app.post('/report', async (req, res) => {
  try {
    const { queue_name, start_date, end_date, view_type } = req.body;
    const startTime = `${start_date} 00:00:00`;
    const endTime = `${end_date} 23:59:59`;
    const viewType = view_type || 'queue';
    
    // Валидация: для очередей требуется queue_name
    if ((viewType === 'queue' || viewType === 'outbound_queue') && !queue_name) {
      return res.status(400).render('error', {
        message: 'Ошибка: для статистики по очередям необходимо выбрать очередь',
        error: { message: 'Поле "Очередь" обязательно для заполнения' },
        helpers,
        NODE_ENV: process.env.NODE_ENV || 'development'
      });
    }
    
    let calls = [];
    
    // Выбираем оптимальный метод запроса в зависимости от размера данных
    if (viewType === 'inbound') {
      // Если указана очередь, фильтруем входящие по очереди (как в PHP)
      if (queue_name) {
        if (USE_ULTRA_FAST_QUERIES) {
          // Используем фильтрацию по очереди через queuelog (совместимо с PHP логикой)
          calls = await getInboundCallsByQueueUltraFast(queue_name, startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
        } else if (USE_LARGE_DATA_OPTIMIZATION) {
          // Fallback: используем оптимизированный метод и фильтруем в памяти
        calls = await getInboundCallsOptimized(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
          calls = calls.filter(call => call.queuename === queue_name);
      } else if (USE_PARALLEL_QUERIES) {
          // Fallback: параллельные запросы и фильтрация в памяти
        calls = await getInboundCallsParallel(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
          calls = calls.filter(call => call.queuename === queue_name);
      } else {
          // Fallback: обычный метод и фильтрация в памяти
        calls = await getInboundCalls(pool, startTime, endTime);
          calls = calls.filter(call => call.queuename === queue_name);
        }
      } else {
        // Если очередь не указана, показываем все входящие (как раньше)
        if (USE_ULTRA_FAST_QUERIES) {
          // Самый быстрый метод для входящих звонков
          calls = await getInboundCallsUltraFast(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
        } else if (USE_LARGE_DATA_OPTIMIZATION) {
        calls = await getInboundCallsOptimized(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else if (USE_PARALLEL_QUERIES) {
        calls = await getInboundCallsParallel(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else {
        calls = await getInboundCalls(pool, startTime, endTime);
        }
      }
    } else if (viewType === 'outbound') {
      if (USE_ULTRA_FAST_QUERIES) {
        // Самый быстрый метод для исходящих (2 запроса + Map)
        calls = await getOutboundCallsUltraFast(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else if (USE_PARALLEL_QUERIES) {
        calls = await getOutboundCallsParallel(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else {
        calls = await getOutboundCalls(pool, startTime, endTime);
      }
    } else if (viewType === 'outbound_queue') {
      // viewType === 'outbound_queue' - исходящие очереди
      // Получаем исходящие звонки от внутренних номеров, которые работают в этой очереди
      if (USE_ULTRA_FAST_QUERIES) {
        // Самый быстрый метод (2 запроса + Map)
        calls = await getOutboundQueueCallsUltraFast(queue_name, startTime, endTime);
      } else {
        calls = await getOutboundQueueCalls(pool, queue_name, startTime, endTime);
      }
    } else {
      // viewType === 'queue'
      if (USE_ULTRA_FAST_QUERIES) {
        // Самый быстрый метод: 2 запроса + Map в памяти (в 228 раз быстрее!)
        calls = await getQueueCallsUltraFast(queue_name, startTime, endTime);
      } else if (USE_LARGE_DATA_OPTIMIZATION) {
        calls = await getQueueCallsOptimized(queue_name, startTime, endTime);
      } else if (USE_PARALLEL_QUERIES) {
        calls = await getQueueCallsParallel(queue_name, startTime, endTime);
      } else {
        // Передаем null - функция использует dbExecute
        calls = await getQueueCalls(null, queue_name, startTime, endTime);
      }
    }
    
    // === ФИЛЬТРАЦИЯ ПО РАБОЧИМ ЧАСАМ ===
    const callsBeforeFilter = calls.length;
    calls = filterByWorkingHours(calls);
    const callsAfterFilter = calls.length;
    
    if (callsBeforeFilter !== callsAfterFilter) {
      logger.info(`⏰ Фильтр рабочих часов: ${callsBeforeFilter} → ${callsAfterFilter} звонков (отфильтровано: ${callsBeforeFilter - callsAfterFilter})`);
    }
    
    // Проверяем перезвоны для очередей и входящих звонков
    let callbackCheckCount = 0;
    let abandonedCount = 0;
    
    if (viewType === 'queue') {
      // Оптимизированная фильтрация пропущенных звонков для обычных очередей (один проход)
      const abandonedCalls = [];
      calls.forEach((call, i) => {
        const isAbandoned = call.status === 'abandoned' || 
                            (call.duration && parseInt(call.duration) <= 5) ||
                            (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller');
        
        if (isAbandoned) {
          abandonedCount++;
          abandonedCalls.push({ index: i, call });
          // Инициализируем callbackStatus как 'Не обработан' для всех пропущенных звонков
          // Это гарантирует, что даже если звонок не пройдет проверку (нет clientNumber или startTime),
          // он будет правильно учтен в формуле расчета "Не обработан"
          if (!calls[i].callbackStatus) {
            calls[i].callbackStatus = 'Не обработан';
          }
        }
      });
      
      // Оптимизированная проверка перезвонов - batch-запрос
      if (abandonedCalls.length > 0) {
        // Передаем null - функция использует dbExecute
        const callbacks = await checkCallbacksBatch(null, abandonedCalls.map(ac => ac.call), queue_name);
        
        // Применяем результаты (оптимизировано)
        // callback всегда является объектом с полями: type, status, callbackTime, recordingFile
        // Если статус не 'Не обработан', значит найден перезвон
        callbacks.forEach((callback, idx) => {
          const { index } = abandonedCalls[idx];
          if (callback && callback.status && (callback.status === 'Перезвонил сам' || callback.status === 'Перезвонили мы')) {
            calls[index].callback = callback;
            calls[index].callbackStatus = callback.status;
            callbackCheckCount++;
            if (callback.recordingFile) {
              calls[index].recordingFile = callback.recordingFile;
            }
          } else {
            // Если перезвона нет или статус 'Не обработан'
            // Убеждаемся, что статус установлен (он уже установлен выше, но на всякий случай)
            calls[index].callbackStatus = 'Не обработан';
          }
        });
      }
      
      if (process.env.DEBUG === 'true') {
        logger.info(`Проверено перезвонов: ${callbackCheckCount} из ${abandonedCount} пропущенных звонков (всего звонков: ${calls.length})`);
      }
    } else if (viewType === 'outbound_queue') {
      // Для исходящих очередей: пропущенные = no_answer, busy, failed (как для входящих)
      const abandonedCalls = [];
      calls.forEach((call, i) => {
        const isAbandoned = call.status === 'no_answer' || 
                            call.status === 'busy' || 
                            call.status === 'failed';
        
        if (isAbandoned) {
          abandonedCount++;
          abandonedCalls.push({ index: i, call });
          // Инициализируем callbackStatus как 'Не обработан' для всех пропущенных звонков
          if (!calls[i].callbackStatus) {
            calls[i].callbackStatus = 'Не обработан';
          }
        }
      });
      
      // Проверка перезвонов для исходящих очередей (используем ту же логику, что и для входящих)
      if (abandonedCalls.length > 0) {
        // Передаем null - функция использует dbExecute
        const callbacks = await checkCallbacksBatchInbound(null, abandonedCalls.map(ac => ac.call));
        
        // Применяем результаты (оптимизировано)
        // callback всегда является объектом с полями: type, status, callbackTime, recordingFile
        // Если статус не 'Не обработан', значит найден перезвон
        callbacks.forEach((callback, idx) => {
          const { index } = abandonedCalls[idx];
          if (callback && callback.status && (callback.status === 'Перезвонил сам' || callback.status === 'Перезвонили мы')) {
            calls[index].callback = callback;
            calls[index].callbackStatus = callback.status;
            callbackCheckCount++;
            if (callback.recordingFile) {
              calls[index].recordingFile = callback.recordingFile;
            }
          } else {
            // Если перезвона нет или статус 'Не обработан'
            calls[index].callbackStatus = 'Не обработан';
          }
        });
      }
      
      if (process.env.DEBUG === 'true') {
        logger.info(`Проверено перезвонов для исходящих очередей: ${callbackCheckCount} из ${abandonedCount} пропущенных звонков (всего звонков: ${calls.length})`);
      }
    } else if (viewType === 'inbound') {
      // Оптимизированная фильтрация пропущенных входящих звонков (один проход)
      const abandonedCalls = [];
      calls.forEach((call, i) => {
        // Для входящих: если есть EVENT из queuelog, используем логику PHP:
        // пропущенный = (EVENT <> 'COMPLETECALLER' AND EVENT <> 'COMPLETEAGENT') OR dur <= 5
        // Иначе используем стандартную логику: не отвечен, занято, неудачно
        let isAbandoned;
        if (call.EVENT) {
          // Логика PHP: если EVENT указан (звонок из очереди), используем его
          const event = (call.EVENT || '').trim().toUpperCase();
          isAbandoned = (event !== 'COMPLETECALLER' && event !== 'COMPLETEAGENT') ||
                       (call.duration && parseInt(call.duration) <= 5);
        } else {
          // Стандартная логика для входящих без EVENT
          isAbandoned = call.status === 'no_answer' || 
                            call.status === 'busy' || 
                            call.status === 'failed' ||
                            (call.duration && parseInt(call.duration) <= 5);
        }
        
        if (isAbandoned) {
          abandonedCount++;
          abandonedCalls.push({ index: i, call });
          // Инициализируем callbackStatus как 'Не обработан' для всех пропущенных звонков
          // Это гарантирует корректный расчет даже если звонок не пройдет проверку
          if (!calls[i].callbackStatus) {
            calls[i].callbackStatus = 'Не обработан';
          }
        }
      });
      
      // Проверка перезвонов для входящих звонков
      if (abandonedCalls.length > 0) {
        // Передаем null - функция использует dbExecute
        const callbacks = await checkCallbacksBatchInbound(null, abandonedCalls.map(ac => ac.call));
        
        // Применяем результаты (оптимизировано)
        // callback всегда является объектом с полями: type, status, callbackTime, recordingFile
        // Если статус не 'Не обработан', значит найден перезвон
        callbacks.forEach((callback, idx) => {
          const { index } = abandonedCalls[idx];
          if (callback && callback.status && (callback.status === 'Перезвонил сам' || callback.status === 'Перезвонили мы')) {
            calls[index].callback = callback;
            calls[index].callbackStatus = callback.status;
            callbackCheckCount++;
            if (callback.recordingFile) {
              calls[index].recordingFile = callback.recordingFile;
            }
          } else {
            // Если перезвона нет или статус 'Не обработан'
            calls[index].callbackStatus = 'Не обработан';
          }
        });
      }
      
      if (process.env.DEBUG === 'true') {
        logger.info(`Проверено перезвонов для входящих: ${callbackCheckCount} из ${abandonedCount} пропущенных звонков (всего звонков: ${calls.length})`);
      }
    }
    
    const stats = calculateStats(calls, viewType);

    res.render('index', { 
      title: viewType === 'inbound' ? 'Входящие звонки - Asterisk Analytics' : 
             viewType === 'outbound' ? 'Исходящие звонки - Asterisk Analytics' : 
             viewType === 'outbound_queue' ? `Исходящие очереди - ${queue_name}` :
             `Отчет по очереди ${queue_name}`,
      queues: getAvailableQueues(),
      selectedQueue: queue_name || '',
      results: { 
        calls: calls.slice(0, 10000),
        stats,
        callsByStatus: {
          answered: stats.answeredCalls,
          abandoned: stats.abandonedCalls
        }
      },
      startDate: start_date,
      endDate: end_date,
      viewType: viewType,
      helpers
    });
  } catch (err) {
    logger.error('Ошибка:', err);
    res.status(500).render('error', { 
      message: 'Произошла ошибка при генерации отчета',
      error: err,
      helpers,
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }
});

// POST /rankings и POST /export-rankings-excel - см. routes/rankings.js

// Экспорт отчета в Excel
app.post('/export-report-excel', async (req, res) => {
  try {
    const XLSX = require('xlsx');
    
    // Логирование для отладки
    logger.info('[EXPORT] Получен запрос на экспорт:', {
      body: req.body,
      contentType: req.get('content-type'),
      hasBody: !!req.body
    });
    
    const { queue_name, start_date, end_date, view_type } = req.body;
    
    logger.info('[EXPORT] Извлеченные значения:', { queue_name, start_date, end_date, view_type });
    
    if (!start_date || !end_date) {
      logger.error('[EXPORT] Ошибка: отсутствуют даты. Получено:', { start_date, end_date });
      return res.status(400).json({ 
        success: false, 
        error: 'Необходимо указать start_date и end_date' 
      });
    }
    
    const startTime = `${start_date} 00:00:00`;
    const endTime = `${end_date} 23:59:59`;
    const viewType = view_type || 'queue';
    
    // Валидация: для очередей требуется queue_name
    if ((viewType === 'queue' || viewType === 'outbound_queue') && !queue_name) {
      return res.status(400).json({
        success: false,
        error: 'Для экспорта очереди необходимо указать queue_name'
      });
    }
    
    let calls = [];
    
    // Получаем данные (та же логика, что и в /report)
    if (viewType === 'inbound') {
      // Если указана очередь, фильтруем входящие по очереди (как в PHP)
      if (queue_name) {
        if (USE_ULTRA_FAST_QUERIES) {
          // Используем фильтрацию по очереди через queuelog (совместимо с PHP логикой)
          calls = await getInboundCallsByQueueUltraFast(queue_name, startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
        } else {
          // Fallback: используем обычный метод (без фильтрации по очереди)
          calls = await getInboundCalls(pool, startTime, endTime);
        }
      } else {
        // Если очередь не указана, показываем все входящие (как раньше)
        if (USE_ULTRA_FAST_QUERIES) {
          // Самый быстрый метод для входящих звонков
          calls = await getInboundCallsUltraFast(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
        } else if (USE_LARGE_DATA_OPTIMIZATION) {
          calls = await getInboundCallsOptimized(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
        } else if (USE_PARALLEL_QUERIES) {
          calls = await getInboundCallsParallel(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
        } else {
          calls = await getInboundCalls(pool, startTime, endTime);
        }
      }
    } else if (viewType === 'outbound') {
      if (USE_ULTRA_FAST_QUERIES) {
        // Самый быстрый метод для исходящих (2 запроса + Map)
        calls = await getOutboundCallsUltraFast(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else if (USE_PARALLEL_QUERIES) {
        calls = await getOutboundCallsParallel(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else {
        calls = await getOutboundCalls(pool, startTime, endTime);
      }
    } else if (viewType === 'outbound_queue') {
      if (USE_ULTRA_FAST_QUERIES) {
        // Самый быстрый метод (2 запроса + Map)
        calls = await getOutboundQueueCallsUltraFast(queue_name, startTime, endTime);
      } else {
        calls = await getOutboundQueueCalls(pool, queue_name, startTime, endTime);
      }
    } else {
      if (USE_ULTRA_FAST_QUERIES) {
        calls = await getQueueCallsUltraFast(queue_name, startTime, endTime);
      } else if (USE_LARGE_DATA_OPTIMIZATION) {
        calls = await getQueueCallsOptimized(queue_name, startTime, endTime);
      } else if (USE_PARALLEL_QUERIES) {
        calls = await getQueueCallsParallel(queue_name, startTime, endTime);
      } else {
        // Передаем null - функция использует dbExecute
        calls = await getQueueCalls(null, queue_name, startTime, endTime);
      }
    }
    
    // Функции форматирования без преобразования таймзоны (данные в БД уже в локальном времени)
    const formatDateForExcel = (dateStr) => {
      if (!dateStr) return '';
      const str = dateStr.toString();
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[3]}.${match[2]}.${match[1]}`;
      if (dateStr instanceof Date) {
        const d = dateStr.getDate().toString().padStart(2, '0');
        const m = (dateStr.getMonth() + 1).toString().padStart(2, '0');
        const y = dateStr.getFullYear();
        return `${d}.${m}.${y}`;
      }
      return '';
    };
    const formatTimeForExcel = (dateStr) => {
      if (!dateStr) return '';
      const str = dateStr.toString();
      const match = str.match(/(\d{2}):(\d{2}):?(\d{2})?/);
      if (match) return `${match[1]}:${match[2]}`;
      if (dateStr instanceof Date) {
        const h = dateStr.getHours().toString().padStart(2, '0');
        const m = dateStr.getMinutes().toString().padStart(2, '0');
        return `${h}:${m}`;
      }
      return '';
    };
    
    // Подготовка данных для Excel
    const excelData = calls.map(call => ({
      'Дата': formatDateForExcel(call.startTime),
      'Время': formatTimeForExcel(call.startTime),
      'От кого': call.from || call.clid || '',
      'Кому': call.to || call.dst || '',
      'Статус': call.status || '',
      'Длительность (сек)': call.duration || 0,
      'Время ожидания (сек)': call.waitTime || 0,
      'Запись': call.recordingfile || call.recordingFile || '',
      'Перезвон': call.callbackStatus || 'Не обработан',
      'Агент': call.agent || ''
    }));
    
    // Создание книги Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Настройка ширины столбцов
    const colWidths = [
      { wch: 12 }, // Дата
      { wch: 10 }, // Время
      { wch: 18 }, // От кого
      { wch: 18 }, // Кому
      { wch: 20 }, // Статус
      { wch: 15 }, // Длительность
      { wch: 18 }, // Время ожидания
      { wch: 40 }, // Запись
      { wch: 15 }, // Перезвон
      { wch: 12 }  // Агент
    ];
    ws['!cols'] = colWidths;
    
    const sheetName = viewType === 'queue' ? `Очередь ${queue_name}` :
                     viewType === 'outbound_queue' ? `Исх очередь ${queue_name}` :
                     viewType === 'inbound' ? 'Входящие' : 'Исходящие';
    
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    
    // Добавляем лист со статистикой
    const stats = calculateStats(calls, viewType);
    const statsData = [{
      'Всего звонков': stats.totalCalls,
      'Отвечено': stats.answeredCalls,
      'Пропущено': stats.abandonedCalls,
      'Процент ответа (%)': stats.answerRate,
      'SLA (%)': stats.slaRate,
      'ASA (сек)': stats.asa,
      'Процент пропущенных (%)': stats.abandonRate,
      'Перезвонил сам': stats.clientCallbacks,
      'Перезвонили мы': stats.agentCallbacks,
      'Не обработан': stats.noCallbacks
    }];
    const statsWs = XLSX.utils.json_to_sheet(statsData);
    statsWs['!cols'] = [{ wch: 20 }];
    XLSX.utils.book_append_sheet(wb, statsWs, 'Статистика');
    
    // Генерация файла
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    // Формируем имя файла с кириллицей
    let filename = '';
    if (viewType === 'queue') {
      filename = `Очередь_${queue_name}_${start_date}_${end_date}.xlsx`;
    } else if (viewType === 'outbound_queue') {
      filename = `Исх_очередь_${queue_name}_${start_date}_${end_date}.xlsx`;
    } else if (viewType === 'inbound') {
      filename = `Входящие_${start_date}_${end_date}.xlsx`;
    } else {
      filename = `Исходящие_${start_date}_${end_date}.xlsx`;
    }
    
    // UTF-8 кодировка для современных браузеров (RFC 5987)
    const filenameUTF8 = encodeURIComponent(filename);
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // Используем только filename* для UTF-8 (RFC 5987) - современные браузеры поддерживают это
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filenameUTF8}`);
    res.send(buffer);
  } catch (error) {
    logger.error('Ошибка при экспорте отчета в Excel:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Тестовый маршрут для отладки
// Service Worker
app.get('/js/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'js', 'sw.js'));
});

// Fallback маршрут для старого формата URL (прямой путь к файлу)
// Поддерживаем форматы: in-..., out-..., q-... (записи очередей)
app.get(/^\/recordings\/((in|out|q)-.+-.+\.mp3)$/, (req, res) => {
  const filename = req.params[0]; // Получаем из регулярного выражения
  logger.info('Fallback route hit with filename:', filename, 'full URL:', req.originalUrl);

  // Извлекаем дату из имени файла (ищем дату YYYYMMDD)
  const dateMatch = filename.match(/20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/);
  if (dateMatch) {
    const datePart = dateMatch[0];
      const year = datePart.substring(0, 4);
      const month = datePart.substring(4, 6);
      const day = datePart.substring(6, 8);
      // Перенаправляем на правильный формат URL
      const correctUrl = `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(filename)}`;
      logger.info('Redirecting old format URL to:', correctUrl);
      return res.redirect(301, correctUrl);
  }

  logger.info('Filename does not contain valid date (YYYYMMDD)');
  return res.status(404).send('File not found');
});

// Обработка OPTIONS запросов для CORS
app.options('/recordings/:year/:month/:day', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Range');
  res.sendStatus(200);
});

app.get('/recordings/:year/:month/:day', (req, res) => {
  let { year, month, day } = req.params;
  let filename = decodeURIComponent(req.query.file || '');
  
  // Fallback: если year выглядит как имя файла (старый формат URL /recordings/filename.mp3)
  // Express интерпретирует это как /recordings/:year/:month/:day, где year = filename, month = undefined, day = undefined
  // Поддерживаем форматы: in-...-YYYYMMDD-..., out-...-YYYYMMDD-..., q-...-YYYYMMDD-...
  if (!filename && year && year.match(/^(in|out|q)-.+-.+\.mp3$/) && !month && !day) {
    filename = year;
    // Извлекаем дату из имени файла (ищем дату YYYYMMDD)
    const dateMatch = filename.match(/20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/);
    if (dateMatch) {
      const datePart = dateMatch[0];
        year = datePart.substring(0, 4);
        month = datePart.substring(4, 6);
        day = datePart.substring(6, 8);
        // Перенаправляем на правильный формат URL
        const correctUrl = `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(filename)}`;
        logger.info('Redirecting old format URL to:', correctUrl);
        return res.redirect(301, correctUrl);
    }
  }

  if (!filename) {
    return res.status(400).send('Filename parameter is required');
  }

  // Проверка формата имени файла
  // Поддерживаем форматы: 
  // - in-...-YYYYMMDD-... (входящие)
  // - out-...-YYYYMMDD-... (исходящие)
  // - q-...-YYYYMMDD-... (записи из очередей, например q-1049-...-YYYYMMDD-...)
  // Проверяем наличие даты YYYYMMDD (год начинается с 2, месяц 01-12, день 01-31)
  const dateMatch = filename.match(/20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/);
  if (!dateMatch || !filename.match(/\.mp3$/)) {
    logger.info('Filename validation failed for:', filename);
    return res.status(400).render('error', {
      message: 'Неверный формат имени файла записи',
      error: { message: `Файл ${filename} имеет неверный формат. Ожидается формат с датой YYYYMMDD и расширением .mp3` },
      helpers,
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }

  const recordingsBase = path.resolve(process.env.RECORDINGS_PATH || '/var/spool/asterisk/monitor');
  const filePath = path.join(recordingsBase, year, month, day, filename);

  // Защита от path traversal
  if (!filePath.startsWith(recordingsBase)) {
    logger.warn(`[Recordings] Path traversal попытка: ${filePath}`);
    return res.status(400).send('Invalid file path');
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).render('error', {
      message: 'Запись не найдена',
      error: { message: `Файл ${filename} не найден в ${year}/${month}/${day}` },
      helpers,
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }

  // Поддержка range requests для перемотки в audio плеере
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(filePath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=31536000',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length'
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Content-Disposition': `inline; filename="${filename}"`
    };
    res.writeHead(200, head);
    fs.createReadStream(filePath).pipe(res);
  }
});

// Функции getQueueCalls, getInboundCalls, getOutboundCalls, getQueueAgents, getOutboundQueueCalls
// перенесены в db-calls.js для уменьшения размера app.js

// Функции расчета статистики (оптимизированная версия - один проход по массиву)
function calculateStats(calls, viewType = 'queue') {
  const totalCalls = calls.length;
  if (totalCalls === 0) {
    return {
      totalCalls: 0,
      answeredCalls: 0,
      abandonedCalls: 0,
      answerRate: 0,
      avgWaitTime: 0,
      avgWaitTimeAnswered: 0,
      avgDuration: 0,
      slaRate: 0,
      slaCalls: 0,
      avgQueueTime: 0,
      peakHour: '-',
      peakHourCalls: 0,
      callsByHour: {},
      clientCallbacks: 0,
      agentCallbacks: 0,
      noCallbacks: 0,
      asa: 0,
      abandonRate: 0
    };
  }
  
  // Определяем функцию для проверки пропущенных звонков (единая логика)
  const isAbandonedCall = (call) => {
    if (viewType === 'inbound') {
      // Если есть EVENT из queuelog, используем логику PHP (совместимость)
      if (call.EVENT) {
        const event = (call.EVENT || '').trim().toUpperCase();
        return (event !== 'COMPLETECALLER' && event !== 'COMPLETEAGENT') ||
               (call.duration && parseInt(call.duration) <= 5);
      }
      // Стандартная логика для входящих без EVENT
      return call.status === 'no_answer' || call.status === 'busy' || call.status === 'failed' ||
             (call.duration && parseInt(call.duration) <= 5);
    } else if (viewType === 'outbound' || viewType === 'outbound_queue') {
      // Для исходящих и исходящих очередей: пропущенные = не отвеченные, занято, неудачно
      return call.status === 'no_answer' || call.status === 'busy' || call.status === 'failed';
    } else {
      // Для очередей: используем ту же логику, что и в рейтинге для консистентности
      // Пропущенный звонок = abandoned ИЛИ duration <= 5 ИЛИ нет connectTime
      return call.status === 'abandoned' || 
             (call.duration && parseInt(call.duration) <= 5) ||
             (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller');
    }
  };
  
  // СНАЧАЛА считаем статистику перезвонов - это определяет abandonedCalls, clientCallbacks, agentCallbacks, noCallbacks
  // Используем общую функцию для единообразия с рейтингом
  const callbackStats = calculateCallbackStats(calls, isAbandonedCall);
  const clientCallbacks = callbackStats.clientCallbacks;
  const agentCallbacks = callbackStats.agentCallbacks;
  const noCallbacks = callbackStats.noCallbacks;
  // Используем abandonedCalls из calculateCallbackStats для согласованности
  const abandonedCalls = callbackStats.abandonedCalls;
  const answeredCalls = totalCalls - abandonedCalls;
  
  // Собираем waitTimes и durations в одном проходе
  const waitTimes = [];
  const durations = [];
  const answeredWaitTimes = [];
  const allWaitTimes = [];
  let slaCalls = 0;
  
  calls.forEach(call => {
    const isAbandoned = isAbandonedCall(call);
    
    // Собираем waitTimes
    const waitTime = call.waitTime || (helpers && helpers.calculateWaitTime ? helpers.calculateWaitTime(call) : null);
    if (waitTime !== '-' && waitTime !== null && waitTime !== undefined) {
      const parsed = parseInt(waitTime);
      // Проверяем разумность значения (не больше 2 часов = 7200 секунд)
      if (!isNaN(parsed) && parsed >= 0 && parsed <= 7200) {
        waitTimes.push(parsed);
        allWaitTimes.push(parsed);
        
        if (!isAbandoned) {
          answeredWaitTimes.push(parsed);
          if (viewType === 'queue' && parsed <= 20) {
            slaCalls++;
          }
        }
      }
    }
    
    // Собираем durations
    if (call.duration) {
      durations.push(parseInt(call.duration) || 0);
    }
  });
  
  const avgWaitTime = waitTimes.length > 0 
    ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
    : 0;
  
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  // SLA: звонки, принятые в первые 20 секунд (только для очередей)
  // Уже посчитано выше в одном проходе
  const slaRate = (viewType === 'queue' || viewType === 'outbound_queue') && totalCalls > 0 ? Math.round(slaCalls / totalCalls * 100) : 0;
  
  // Среднее время в очереди для всех звонков (уже посчитано выше)
  const avgQueueTime = allWaitTimes.length > 0
    ? Math.round(allWaitTimes.reduce((a, b) => a + b, 0) / allWaitTimes.length)
    : 0;

  // Пиковый час и разбивка по часам
  const callsByHour = {};
  for (let i = 0; i < 24; i++) {
    callsByHour[i] = { total: 0, answered: 0, abandoned: 0, noCallbacks: 0 };
  }
  
  calls.forEach((call, idx) => {
    if (call.startTime) {
      // Извлекаем час напрямую из строки (данные уже в локальном времени)
      const str = call.startTime.toString();
      
      // Отладка для первых 3 звонков (если включена)
      if (process.env.DEBUG_HOURS === 'true' && idx < 3) {
        logger.info(`[DEBUG Hour] call.startTime:`, call.startTime, 'type:', typeof call.startTime, 'toString:', str);
      }
      
      // Ищем час в формате "HH:MM" или "YYYY-MM-DD HH:MM:SS"
      const match = str.match(/(\d{2}):(\d{2})/);
      const hour = match ? parseInt(match[1], 10) : 0;
      
      if (process.env.DEBUG_HOURS === 'true' && idx < 3) {
        logger.info(`[DEBUG Hour] extracted hour:`, hour, 'from match:', match);
      }
      
      callsByHour[hour].total++;
      // Для входящих: пропущенные = no_answer, busy, failed
      // Для исходящих и исходящих очередей: пропущенные = no_answer, busy, failed
      // Для обычных очередей: пропущенные = abandoned
      const isAbandoned = isAbandonedCall(call);
      
      if (isAbandoned) {
        callsByHour[hour].abandoned++;
        // "Не обработан" - только те пропущенные, у которых НЕТ перезвонов
        // Используем ту же логику, что и в общей статистике
        const hasCallback = call.callbackStatus === 'Перезвонил сам' || call.callbackStatus === 'Перезвонили мы';
        if (!hasCallback) {
          callsByHour[hour].noCallbacks++;
        }
      } else {
        callsByHour[hour].answered++;
      }
    }
  });
  
  let peakHour = null;
  let peakHourCalls = 0;
  Object.keys(callsByHour).forEach(hour => {
    if (callsByHour[hour].total > peakHourCalls) {
      peakHourCalls = callsByHour[hour].total;
      peakHour = parseInt(hour);
    }
  });
  const peakHourFormatted = peakHour !== null ? `${peakHour.toString().padStart(2, '0')}:00` : '-';

  // Среднее ожидание для отвеченных звонков (уже посчитано выше в одном проходе)
  let avgWaitTimeAnswered = (viewType === 'queue' || viewType === 'outbound_queue') && answeredWaitTimes.length > 0
    ? Math.round(answeredWaitTimes.reduce((a, b) => a + b, 0) / answeredWaitTimes.length)
    : avgWaitTime;

  // Проверяем разумность значения (не больше 2 часов = 7200 секунд)
  if (isNaN(avgWaitTimeAnswered) || avgWaitTimeAnswered < 0 || avgWaitTimeAnswered > 7200) {
    avgWaitTimeAnswered = 0;
  }
  
  // Профессиональные метрики колл-центра
  // ASA (Average Speed of Answer) - среднее время ответа на звонок (уже посчитано выше)
  let asa = avgWaitTimeAnswered;
  
  // Дополнительная проверка на разумность значения
  if (isNaN(asa) || asa < 0 || asa > 7200) {
    asa = 0;
  }
  
  // Abandon Rate - процент пропущенных звонков
  const abandonRate = totalCalls > 0 
    ? Math.round((abandonedCalls / totalCalls) * 100 * 10) / 10 // Округляем до 1 знака после запятой
    : 0;
  
  // Отладочная информация
  const abandonedCount = calls.filter(c => c.status === 'abandoned').length;
  const withCallbackStatus = calls.filter(c => c.callbackStatus).length;
  
  // Проверка согласованности данных графика и статистики
  const totalNoCallbacksFromChart = Object.values(callsByHour).reduce((sum, hour) => sum + hour.noCallbacks, 0);
  
  logger.info('Статистика перезвонов:', {
    clientCallbacks,
    agentCallbacks,
    noCallbacks,
    abandonedCalls,
    calculation: `${abandonedCalls} - ${clientCallbacks} - ${agentCallbacks} = ${noCallbacks}`,
    totalAbandoned: abandonedCount,
    withCallbackStatus,
    totalCalls: calls.length,
    check: `clientCallbacks(${clientCallbacks}) + agentCallbacks(${agentCallbacks}) + noCallbacks(${noCallbacks}) = ${clientCallbacks + agentCallbacks + noCallbacks}, должно быть ${abandonedCalls}`,
    chartNoCallbacks: totalNoCallbacksFromChart,
    match: noCallbacks === totalNoCallbacksFromChart ? '✅ Совпадает' : `❌ Не совпадает (статистика: ${noCallbacks}, график: ${totalNoCallbacksFromChart})`
  });

  return {
    totalCalls,
    answeredCalls,
    abandonedCalls,
    answerRate: totalCalls > 0 ? Math.round(answeredCalls/totalCalls*100) : 0,
    avgWaitTime,
    avgWaitTimeAnswered,
    avgDuration,
    slaRate,
    slaCalls,
    avgQueueTime,
    peakHour: peakHourFormatted,
    peakHourCalls,
    callsByHour,
    // Статистика перезвонов
    clientCallbacks,
    agentCallbacks,
    noCallbacks,
    // Профессиональные метрики
    asa, // Average Speed of Answer (секунды)
    abandonRate // Abandon Rate (%)
  };
}

// Инициализация ежедневной отправки отчетов по email
function initializeEmailReports() {
  // Проверяем, включена ли отправка email
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    logger.info('📧 Ежедневные email отчеты отключены (нет конфигурации SMTP)');
    return;
  }

  const cron = require('node-cron');
  const { generateQueueReport, sendQueueReport } = require('./email-service');
  const { format, subDays } = require('date-fns');

  // Передаем функции из app.js в email-service (те же, что используются в веб-интерфейсе)
  const callFunctions = {
    getQueueCalls,
    getQueueCallsUltraFast,
    getQueueCallsOptimized,
    getQueueCallsParallel,
    getInboundCalls,
    getInboundCallsUltraFast,
    getInboundCallsByQueueUltraFast,
    getOutboundCalls,
    getOutboundCallsUltraFast,
    getOutboundQueueCallsUltraFast,
    checkCallbacksBatch,
    checkCallbacksBatchInbound,
    calculateStats
  };

  // Настраиваем cron для отправки отчета каждый день в 23:59
  // Формат: секунда минута час день месяц день_недели
  const cronSchedule = process.env.EMAIL_CRON_SCHEDULE || '59 23 * * *'; // По умолчанию 23:59 каждый день
  
  cron.schedule(cronSchedule, async () => {
    try {
      logger.info('📧 Начало генерации ежедневных отчетов по очередям...');
      
      // Получаем часовой пояс из настроек (без хардкода)
      const timezone = getTimezone();
      const offsetHours = getTimezoneOffset(timezone);
      
      // Получаем текущее время в UTC и добавляем смещение часового пояса
      const nowUTC = new Date(); // Текущее время в UTC
      const nowInLocalTZ = new Date(nowUTC.getTime() + (offsetHours * 60 * 60 * 1000)); // Текущее время в локальном TZ
      
      // Отчет генерируется за текущую дату (дату генерации) в локальном часовом поясе
      const todayStr = format(nowInLocalTZ, 'yyyy-MM-dd'); // Текущая дата в локальном TZ
      
      // Конвертируем границы дня из локального времени в UTC для запросов к базе данных
      // Если база данных хранит время в UTC (обычно для Asterisk),
      // нужно правильно конвертировать границы дня:
      // - Начало дня в локальном TZ (00:00:00) -> начало дня в UTC
      // - Конец дня в локальном TZ (23:59:59) -> конец дня в UTC
      // Например, для MSK (UTC+3): 29.12.2025 00:00:00 MSK = 28.12.2025 21:00:00 UTC
      //                           29.12.2025 23:59:59 MSK = 29.12.2025 20:59:59 UTC
      const startOfDayLocal = new Date(todayStr + 'T00:00:00');
      const endOfDayLocal = new Date(todayStr + 'T23:59:59');
      
      // Вычитаем offset, чтобы получить UTC время (local = UTC + offset, значит UTC = local - offset)
      const startOfDayUTC = new Date(startOfDayLocal.getTime() - (offsetHours * 60 * 60 * 1000));
      const endOfDayUTC = new Date(endOfDayLocal.getTime() - (offsetHours * 60 * 60 * 1000));
      
      const startTimeUTC = format(startOfDayUTC, 'yyyy-MM-dd HH:mm:ss');
      const endTimeUTC = format(endOfDayUTC, 'yyyy-MM-dd HH:mm:ss');
      
      logger.info(`📧 Генерация отчета за ${todayStr} ${timezone} (UTC+${offsetHours})`);
      logger.info(`📧 Диапазон запроса в UTC: ${startTimeUTC} - ${endTimeUTC}`);
      
      // Получаем список всех очередей с активными email адресами
      const queuesWithEmails = await settingsDb.getAll(`
        SELECT DISTINCT queue_name
        FROM email_reports
        WHERE is_active = 1
      `);
      
      if (!queuesWithEmails || queuesWithEmails.length === 0) {
        logger.info('📧 Нет очередей с активными email адресами для отправки отчетов');
        return;
      }
      
      let successCount = 0;
      let errorCount = 0;
      
      // Отправляем отчет для каждой очереди параллельно (оптимизация)
      // Получаем pool динамически, так как он может быть lazy-initialized
      const { getPool } = require('./db-optimizer');
      const currentPool = getPool();
      
      const reportPromises = queuesWithEmails.map(async (queueRow) => {
        const queueName = queueRow.queue_name;
        try {
          logger.info(`📧 Генерация отчета для очереди ${queueName}...`);
          // Передаем дату отчета (в локальном TZ) и диапазон времени в UTC для запросов
          const reportData = await generateQueueReport(currentPool, queueName, todayStr, startTimeUTC, endTimeUTC, callFunctions);
          const result = await sendQueueReport(reportData, queueName, currentPool);
          
          if (result.success) {
            logger.info(`✅ Отчет для очереди ${queueName} успешно отправлен`);
            return { success: true, queueName };
          } else {
            logger.error(`❌ Ошибка отправки отчета для очереди ${queueName}:`, result.error);
            return { success: false, queueName, error: result.error };
          }
        } catch (error) {
          logger.error(`❌ Ошибка при генерации/отправке отчета для очереди ${queueName}:`, error);
          return { success: false, queueName, error: error.message };
        }
      });
      
      // Ждем завершения всех отчетов
      const results = await Promise.allSettled(reportPromises);
      results.forEach((result, idx) => {
        if (result.status === 'fulfilled') {
          if (result.value.success) {
            successCount++;
          } else {
            errorCount++;
          }
        } else {
          errorCount++;
          logger.error(`❌ Ошибка при обработке очереди ${queuesWithEmails[idx].queue_name}:`, result.reason);
        }
      });
      
      logger.info(`📧 Итоги отправки отчетов: успешно ${successCount}, ошибок ${errorCount}`);
    } catch (error) {
      logger.error('❌ Ошибка при генерации/отправке ежедневных отчетов:', error);
    }
  }, {
    scheduled: true,
    timezone: getTimezone()
  });

  logger.info(`📧 Ежедневные email отчеты настроены. Расписание: ${cronSchedule} (${getTimezone()})`);
  logger.info('📧 Отчеты будут отправляться для каждой очереди отдельно на указанные email адреса');
}

// API endpoint для получения названий очередей
app.get('/api/queue-names', async (req, res) => {
  try {
    // Убеждаемся, что кэш актуален
    if (Object.keys(queueNamesCache).length === 0 || Date.now() - queueNamesCacheTime > QUEUES_CACHE_TTL) {
      await refreshQueueNamesCache();
    }
    
    res.json(queueNamesCache);
  } catch (error) {
    logger.error('Ошибка получения названий очередей:', error);
    res.status(500).json({ error: error.message });
  }
});

// Запуск сервера
// Убеждаемся, что все кэши загружены ПЕРЕД тем, как сервер начнет принимать запросы
let serverReady = false;

// Создаем HTTP сервер для Express и WebSocket
const server = http.createServer(app);

// Инициализируем WebSocket
const io = initWebSocket(server);

// Сначала инициализируем адаптер БД, затем приложение
initializeDatabaseAdapter()
  .then(() => initializeApp())
  .then(() => {
    serverReady = true;
    server.listen(PORT, () => {
      logger.info(`Сервер запущен на http://localhost:${PORT}`);
      logger.info(`WebSocket: ws://localhost:${PORT}`);
      logger.info(`Конфигурация фильтрации: минимальная длина номера для исходящих = ${CALL_FILTER_CONFIG.outboundMinLength}`);
    
      // Инициализируем отправку email отчетов
      initializeEmailReports();
    });
  })
  .catch(err => {
    logger.error('Ошибка при инициализации:', err);
    // Запускаем сервер даже при ошибке, но с предупреждением
    serverReady = true;
    server.listen(PORT, () => {
      logger.info(`⚠️ Сервер запущен с ошибками инициализации на http://localhost:${PORT}`);
    });
});

// === Graceful Shutdown ===
function gracefulShutdown(signal) {
  logger.info(`\n⏹️  Получен сигнал ${signal}, начинаем graceful shutdown...`);
  
  server.close(() => {
    logger.info('✅ HTTP сервер остановлен');
    
    // Закрываем WebSocket
    if (io) {
      io.close(() => {
        logger.info('✅ WebSocket сервер остановлен');
      });
    }
    
    // Закрываем пул соединений с БД
    if (pool && typeof pool.end === 'function') {
      pool.end()
        .then(() => {
          logger.info('✅ Пул соединений с БД закрыт');
          process.exit(0);
        })
        .catch((err) => {
          logger.error('❌ Ошибка при закрытии пула БД:', err);
          process.exit(1);
        });
    } else {
      process.exit(0);
    }
  });
  
  // Принудительный выход через 10 секунд
  setTimeout(() => {
    logger.error('⚠️ Принудительное завершение после таймаута');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));