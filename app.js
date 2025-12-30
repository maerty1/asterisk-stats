require('dotenv').config();
const express = require('express');
const { format, subDays } = require('date-fns');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const { exec } = require('child_process');

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
  checkCallbacksParallel,
  PARALLEL_CONFIG 
} = require('./db-parallel');

// Модуль оптимизированных запросов для больших данных в MariaDB
const {
  getQueueCallsOptimized,
  getInboundCallsOptimized,
  checkCallbacksOptimized
} = require('./db-large-data');

// Ультра-оптимизированные запросы (самые быстрые) - все используют стратегию 2 запроса + Map
const {
  getQueueCallsUltraFast,
  getInboundCallsUltraFast,
  getInboundCallsByQueueUltraFast,
  getOutboundCallsUltraFast,
  getOutboundQueueCallsUltraFast
} = require('./db-optimized-queue');

// Модуль рейтингов очередей
const {
  getQueueRankings,
  getTopQueues
} = require('./queue-rankings');

// SQLite модуль для настроек и email_reports
const settingsDb = require('./settings-db');

// Флаги использования оптимизаций
const USE_ULTRA_FAST_QUERIES = process.env.USE_ULTRA_FAST_QUERIES !== 'false'; // По умолчанию включено (самый быстрый)
const USE_PARALLEL_QUERIES = process.env.USE_PARALLEL_QUERIES !== 'false';
const USE_LARGE_DATA_OPTIMIZATION = process.env.USE_LARGE_DATA_OPTIMIZATION === 'true';

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
      
      console.log('✅ Настройки загружены из базы данных');
      
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
      console.log('✅ Адаптер БД инициализирован с настройками из базы данных');
      
    } catch (err) {
      console.error('❌ Ошибка инициализации базы данных настроек:', err);
      console.log('⚠️  Используются настройки из .env файла');
      
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

let availableQueues = [];
let queuesCacheTime = 0;
const QUEUES_CACHE_TTL = parseInt(process.env.QUEUES_CACHE_TTL) || 3600000; // 1 час по умолчанию
let queueNamesCache = {}; // Кэш названий очередей: { "1049": "Название очереди" }
let queueNamesCacheTime = 0;

// Middleware
app.use(compression()); // Сжатие gzip
app.set('view engine', 'ejs');
app.set('view cache', false); // Отключаем кэширование шаблонов
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
    const start = new Date(call.startTime);
    const end = new Date(endTime);
    return Math.round((end - start) / 1000);
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
    } catch (e) {}
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
    } catch (e) {}
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
    } catch (e) {}
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
  
  console.log('🔄 Загрузка кэша очередей...');
  await refreshQueuesCache();
  console.log('🔄 Загрузка названий очередей...');
  await refreshQueueNamesCache();
  console.log('✅ Кэши загружены, готов к работе');
  
  // Выводим статистику пула при старте
  if (process.env.DEBUG_DB === 'true') {
    console.log('📊 Статистика пула соединений:', getPoolStats());
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
    console.log('Загружено очередей:', availableQueues.length);
  } catch (err) {
    console.error('Ошибка при загрузке очередей:', err);
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
      console.log('Загружено названий очередей:', Object.keys(queueNamesCache).length);
    }
  } catch (err) {
    console.error('Ошибка при загрузке названий очередей:', err);
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
      console.error('Ошибка при обновлении кэша названий очередей:', err);
    });
    return null;
  }
  
  const now = Date.now();
  if (now - queueNamesCacheTime > QUEUES_CACHE_TTL) {
    // Кэш устарел - обновляем асинхронно, но возвращаем текущее значение
    refreshQueueNamesCache().catch(err => {
      console.error('Ошибка при обновлении кэша названий очередей:', err);
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
      console.error('Ошибка при обновлении кэша очередей:', err);
    });
  }
  return availableQueues;
}

// Функция получения часового пояса из настроек (без хардкода)
function getTimezone() {
  try {
    const settings = settingsDb.getAllSettings();
    return settings.TZ || 'Europe/Moscow';
  } catch (err) {
    // Если база не инициализирована, используем из env или дефолт
    return process.env.TZ || 'Europe/Moscow';
  }
}

// Функция получения смещения часового пояса в часах от UTC
function getTimezoneOffset(timezone) {
  // Маппинг основных часовых поясов на смещение от UTC
  const timezoneOffsets = {
    'Europe/Moscow': 3,
    'Europe/Kiev': 2,
    'Europe/Kyiv': 2,
    'Europe/Minsk': 3,
    'Asia/Yekaterinburg': 5,
    'Asia/Krasnoyarsk': 7,
    'Asia/Irkutsk': 8,
    'Asia/Yakutsk': 9,
    'Asia/Vladivostok': 10,
    'Europe/London': 0,
    'Europe/Paris': 1,
    'Europe/Berlin': 1,
    'America/New_York': -5,
    'America/Los_Angeles': -8,
    'Asia/Tashkent': 5,
    'Asia/Almaty': 6
  };
  
  // Проверяем точное совпадение
  if (timezoneOffsets.hasOwnProperty(timezone)) {
    return timezoneOffsets[timezone];
  }
  
  // Проверяем по ключевым словам
  if (timezone.includes('Moscow') || timezone.includes('Minsk')) {
    return 3;
  }
  if (timezone.includes('Kiev') || timezone.includes('Kyiv') || timezone.includes('EET')) {
    return 2;
  }
  if (timezone.includes('London') || timezone.includes('UTC')) {
    return 0;
  }
  
  // По умолчанию 0 (UTC), если не определили
  return 0;
}

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

app.get('/', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Аналитика звонков',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'queue',
    helpers
  });
});

app.get('/inbound', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Входящие звонки - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'inbound',
    helpers
  });
});

app.get('/outbound-queue', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Исходящие очереди - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'outbound_queue',
    helpers
  });
});

app.get('/outbound', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Исходящие звонки - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'outbound',
    helpers
  });
});

app.get('/rankings', (req, res) => {
  const params = getFilterParams(req);
  res.render('rankings', { 
    title: 'Рейтинг очередей - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    sortBy: req.query.sortBy || 'composite',
    departmentFilter: req.query.departmentFilter || '',
    helpers
  });
});

// ==========================================
// API для управления настройками
// ==========================================

// Получить все настройки
app.get('/api/settings', async (req, res) => {
  try {
    const settings = settingsDb.getAllSettings();
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Ошибка получения настроек:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Сохранить настройки
app.post('/api/settings', async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ 
        success: false, 
        error: 'Неверный формат данных' 
      });
    }
    
    // Сохраняем каждую настройку
    for (const [key, value] of Object.entries(settings)) {
      await settingsDb.setSetting(key, value);
    }
    
    // Отправляем ответ клиенту перед перезапуском
    res.json({ 
      success: true, 
      message: 'Настройки успешно сохранены. Приложение перезапускается...',
      restarting: true
    });
    
    // Перезапускаем приложение через 1 секунду (даем время на отправку ответа)
    setTimeout(() => {
      console.log('🔄 Перезапуск приложения после изменения настроек...');
      
      // Проверяем, запущено ли приложение как systemd служба
      exec('systemctl is-active --quiet asterisk-stats.service', (error) => {
        if (error === null) {
          // Запущено как служба - используем systemctl
          console.log('✅ Используется systemd служба, перезапускаем через systemctl...');
          exec('systemctl restart asterisk-stats.service', (err) => {
            if (err) {
              console.error('❌ Ошибка перезапуска через systemctl:', err);
              // Fallback - завершаем процесс, systemd перезапустит
              setTimeout(() => process.exit(0), 1000);
            } else {
              console.log('✅ Команда перезапуска отправлена в systemd');
              // Завершаем процесс - systemd перезапустит его
              setTimeout(() => process.exit(0), 500);
            }
          });
        } else {
          // Не запущено как служба - используем скрипт
          console.log('⚠️ Приложение не запущено как служба, используем скрипт перезапуска...');
          const restartHelper = path.join(__dirname, 'restart-helper.sh');
          
          exec(`bash "${restartHelper}" > /dev/null 2>&1 &`, {
            detached: true,
            stdio: 'ignore'
          }, (err) => {
            if (err) {
              console.error('❌ Ошибка запуска скрипта перезапуска:', err);
              setTimeout(() => process.exit(0), 1000);
            } else {
              console.log('✅ Скрипт перезапуска запущен');
              setTimeout(() => process.exit(0), 1500);
            }
          });
        }
      });
    }, 1000);
    
  } catch (error) {
    console.error('Ошибка сохранения настроек:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==========================================
// API для управления email адресами
// ==========================================

// Получить все email адреса для очереди
app.get('/api/email-reports/:queueName', async (req, res) => {
  try {
    const { queueName } = req.params;
    const rows = await settingsDb.getAll(`
      SELECT id, queue_name, email, is_active, created_at, updated_at
      FROM email_reports
      WHERE queue_name = ?
      ORDER BY created_at DESC
    `, [queueName]);
    
    res.json({ success: true, emails: rows });
  } catch (error) {
    console.error('Ошибка получения email адресов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Получить все email адреса (для всех очередей)
app.get('/api/email-reports', async (req, res) => {
  try {
    const rows = await settingsDb.getAll(`
      SELECT id, queue_name, email, is_active, created_at, updated_at
      FROM email_reports
      ORDER BY queue_name, created_at DESC
    `);
    
    res.json({ success: true, emails: rows });
  } catch (error) {
    console.error('Ошибка получения email адресов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Добавить email адрес для очереди
app.post('/api/email-reports', async (req, res) => {
  try {
    const { queue_name, email } = req.body;
    
    if (!queue_name || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'queue_name и email обязательны' 
      });
    }
    
    // Валидация email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Неверный формат email адреса' 
      });
    }
    
    // SQLite использует INSERT OR REPLACE для обработки дубликатов
    const [result] = await settingsDb.execute(`
      INSERT OR REPLACE INTO email_reports (queue_name, email, is_active, updated_at)
      VALUES (?, ?, 1, datetime('now'))
    `, [queue_name, email]);
    
    // Получаем ID вставленной/обновленной записи
    const insertedRow = await settingsDb.getOne(`
      SELECT id FROM email_reports 
      WHERE queue_name = ? AND email = ?
    `, [queue_name, email]);
    
    res.json({ 
      success: true, 
      message: 'Email адрес успешно добавлен',
      id: insertedRow ? insertedRow.id : result.insertId 
    });
  } catch (error) {
    console.error('Ошибка добавления email адреса:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Обновить статус email адреса
app.patch('/api/email-reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;
    
    await settingsDb.execute(`
      UPDATE email_reports
      SET is_active = ?, updated_at = datetime('now')
      WHERE id = ?
    `, [is_active === true || is_active === 'true' || is_active === 1 ? 1 : 0, id]);
    
    res.json({ success: true, message: 'Email адрес обновлен' });
  } catch (error) {
    console.error('Ошибка обновления email адреса:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Удалить email адрес
app.delete('/api/email-reports/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await settingsDb.execute(`
      DELETE FROM email_reports
      WHERE id = ?
    `, [id]);
    
    res.json({ success: true, message: 'Email адрес удален' });
  } catch (error) {
    console.error('Ошибка удаления email адреса:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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
      
      console.log(`📧 Генерация отчета для очереди ${queue_name} за ${reportDate} (${timezone})...`);
      console.log(`📧 Диапазон запроса в UTC: ${startTimeUTC} - ${endTimeUTC}`);
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
      console.log(`📧 Генерация общего отчета за ${reportDate}...`);
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
    console.error('Ошибка при отправке отчета:', error);
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
        } else {
          // Fallback: используем обычный метод (без фильтрации по очереди)
          calls = await getInboundCalls(pool, startTime, endTime);
          // Фильтруем в памяти по queuename (менее эффективно)
          // TODO: добавить поддержку фильтрации в других методах
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
        console.log(`Проверено перезвонов: ${callbackCheckCount} из ${abandonedCount} пропущенных звонков (всего звонков: ${calls.length})`);
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
        console.log(`Проверено перезвонов для исходящих очередей: ${callbackCheckCount} из ${abandonedCount} пропущенных звонков (всего звонков: ${calls.length})`);
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
        console.log(`Проверено перезвонов для входящих: ${callbackCheckCount} из ${abandonedCount} пропущенных звонков (всего звонков: ${calls.length})`);
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
    console.error('Ошибка:', err);
    res.status(500).render('error', { 
      message: 'Произошла ошибка при генерации отчета',
      error: err,
      helpers,
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }
});

app.post('/rankings', async (req, res) => {
  try {
    // Обрабатываем как JSON или как form-data
    const start_date = req.body.start_date;
    const end_date = req.body.end_date;
    const sortBy = req.body.sortBy;
    const departmentFilter = req.body.departmentFilter || null;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ 
        success: false, 
        error: 'Необходимо указать start_date и end_date' 
      });
    }
    
    const startTime = `${start_date} 00:00:00`;
    const endTime = `${end_date} 23:59:59`;
    const sortCriteria = sortBy || 'composite';
    
    console.log(`[Rankings] Запрос рейтинга: ${startTime} - ${endTime}, критерий: ${sortCriteria}, отдел: ${departmentFilter || 'все'}`);
    
    const rankings = await getQueueRankings(startTime, endTime, sortCriteria, departmentFilter);
    
    console.log(`[Rankings] Найдено очередей: ${rankings.length}`);
    
    res.json({
      success: true,
      rankings,
      period: {
        start: start_date,
        end: end_date
      },
      sortBy: sortCriteria,
      departmentFilter: departmentFilter || null
    });
  } catch (error) {
    console.error('Ошибка при получении рейтинга:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Экспорт рейтинга в Excel
app.post('/export-rankings-excel', async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { start_date, end_date, sortBy, departmentFilter } = req.body;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ 
        success: false, 
        error: 'Необходимо указать start_date и end_date' 
      });
    }
    
    const startTime = `${start_date} 00:00:00`;
    const endTime = `${end_date} 23:59:59`;
    const sortCriteria = sortBy || 'composite';
    
    const rankings = await getQueueRankings(startTime, endTime, sortCriteria, departmentFilter || null);
    
    // Подготовка данных для Excel
    const excelData = rankings.map((queue, index) => ({
      'Ранг': queue.rank,
      'Очередь': queue.queueName,
      'Название': queue.queueDisplayName.replace(/^\d+\s*\(|\)$/g, '').replace(/^\d+\s*/, ''),
      'Отдел': queue.department || 'Не указан',
      'Всего звонков': queue.totalCalls,
      'Отвечено': queue.answeredCalls,
      'Процент ответа (%)': queue.answerRate,
      'SLA (%)': queue.slaRate,
      'Пропущено': queue.abandonedCalls,
      'Процент пропущенных (%)': queue.abandonRate,
      'ASA (сек)': queue.asa,
      'Комплексный рейтинг': queue.compositeScore.toFixed(1),
      'Перезвонил сам': queue.clientCallbacks || 0,
      'Перезвонили мы': queue.agentCallbacks || 0,
      'Не обработан': queue.noCallbacks || 0
    }));
    
    // Создание книги Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Настройка ширины столбцов
    const colWidths = [
      { wch: 6 },  // Ранг
      { wch: 12 }, // Очередь
      { wch: 30 }, // Название
      { wch: 15 }, // Отдел
      { wch: 12 }, // Всего звонков
      { wch: 10 }, // Отвечено
      { wch: 15 }, // Процент ответа
      { wch: 10 }, // SLA
      { wch: 12 }, // Пропущено
      { wch: 20 }, // Процент пропущенных
      { wch: 12 }, // ASA
      { wch: 18 }, // Комплексный рейтинг
      { wch: 14 }, // Перезвонил сам
      { wch: 14 }, // Перезвонили мы
      { wch: 12 }  // Не обработан
    ];
    ws['!cols'] = colWidths;
    
    XLSX.utils.book_append_sheet(wb, ws, 'Рейтинг очередей');
    
    // Генерация файла
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const filename = `Рейтинг_очередей_${start_date}_${end_date}.xlsx`;
    // UTF-8 кодировка для современных браузеров (RFC 5987)
    const filenameUTF8 = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    // Используем только filename* для UTF-8 (RFC 5987)
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filenameUTF8}`);
    res.send(buffer);
  } catch (error) {
    console.error('Ошибка при экспорте рейтинга в Excel:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Экспорт отчета в Excel
app.post('/export-report-excel', async (req, res) => {
  try {
    const XLSX = require('xlsx');
    
    // Логирование для отладки
    console.log('[EXPORT] Получен запрос на экспорт:', {
      body: req.body,
      contentType: req.get('content-type'),
      hasBody: !!req.body
    });
    
    const { queue_name, start_date, end_date, view_type } = req.body;
    
    console.log('[EXPORT] Извлеченные значения:', { queue_name, start_date, end_date, view_type });
    
    if (!start_date || !end_date) {
      console.error('[EXPORT] Ошибка: отсутствуют даты. Получено:', { start_date, end_date });
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
    console.error('Ошибка при экспорте отчета в Excel:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Тестовый маршрут для отладки
app.get('/test', (req, res) => {
  res.json({
    params: req.params,
    query: req.query,
    originalUrl: req.originalUrl,
    path: req.path
  });
});

// Service Worker
app.get('/js/sw.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'js', 'sw.js'));
});

// Fallback маршрут для старого формата URL (прямой путь к файлу)
// Поддерживаем форматы: in-..., out-..., q-... (записи очередей)
app.get(/^\/recordings\/((in|out|q)-.+-.+\.mp3)$/, (req, res) => {
  const filename = req.params[0]; // Получаем из регулярного выражения
  console.log('Fallback route hit with filename:', filename, 'full URL:', req.originalUrl);

  // Извлекаем дату из имени файла (ищем дату YYYYMMDD)
  const dateMatch = filename.match(/20\d{2}(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])/);
  if (dateMatch) {
    const datePart = dateMatch[0];
      const year = datePart.substring(0, 4);
      const month = datePart.substring(4, 6);
      const day = datePart.substring(6, 8);
      // Перенаправляем на правильный формат URL
      const correctUrl = `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(filename)}`;
      console.log('Redirecting old format URL to:', correctUrl);
      return res.redirect(301, correctUrl);
  }

  console.log('Filename does not contain valid date (YYYYMMDD)');
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
        console.log('Redirecting old format URL to:', correctUrl);
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
    console.log('Filename validation failed for:', filename);
    return res.status(400).render('error', {
      message: 'Неверный формат имени файла записи',
      error: { message: `Файл ${filename} имеет неверный формат. Ожидается формат с датой YYYYMMDD и расширением .mp3` },
      helpers,
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }

  const filePath = path.join(
    process.env.RECORDINGS_PATH || '/var/spool/asterisk/monitor',
    year, month, day, filename
  );

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

// Функция получения звонков
async function getQueueCalls(conn, queueName, startTime, endTime) {
  // Если conn null или не имеет метода execute, используем dbExecute
  if (!conn || typeof conn.execute !== 'function') {
    const { execute: dbExecute } = require('./db-optimizer');
    const [rows] = await dbExecute(`
      SELECT 
        q.time, q.event, q.callid, q.queuename, q.agent, 
        q.data1, q.data2, q.data3, q.data4, q.data5,
        c.recordingfile, c.linkedid
      FROM asteriskcdrdb.queuelog q
      LEFT JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid
      WHERE q.queuename = ? 
        AND q.time >= ? 
        AND q.time <= ?
      ORDER BY q.time ASC
    `, [queueName, startTime, endTime]);
    return rows;
  }
  
  const [rows] = await conn.execute(`
    SELECT 
      q.time, q.event, q.callid, q.queuename, q.agent, 
      q.data1, q.data2, q.data3, q.data4, q.data5,
      c.recordingfile, c.linkedid
    FROM asteriskcdrdb.queuelog q
    LEFT JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid AND c.disposition = 'ANSWERED'
    WHERE q.queuename = ? 
      AND q.time BETWEEN ? AND ?
    ORDER BY q.time
  `, [queueName, startTime, endTime]);

  const calls = {};
  rows.forEach(row => {
    if (!calls[row.callid]) {
      calls[row.callid] = {
        callId: row.callid,
        events: [],
        status: 'abandoned', // По умолчанию считаем пропущенным
        startTime: null,
        connectTime: null,
        endTime: null,
        clientNumber: null,
        queuePosition: null,
        agent: null,
        duration: null,
        waitTime: null,
        recordingFile: row.recordingfile,
        linkedid: row.linkedid
      };
    }
    
    calls[row.callid].events.push(row);
    
    // Обновляем recordingFile, если оно есть в текущей строке
    if (row.recordingfile) {
      calls[row.callid].recordingFile = row.recordingfile;
    }
    
    // Функция для преобразования времени в строку
    const timeToString = (time) => {
      if (!time) return null;
      if (typeof time === 'string') return time;
      if (time instanceof Date) {
        const year = time.getFullYear();
        const month = String(time.getMonth() + 1).padStart(2, '0');
        const day = String(time.getDate()).padStart(2, '0');
        const hours = String(time.getHours()).padStart(2, '0');
        const minutes = String(time.getMinutes()).padStart(2, '0');
        const seconds = String(time.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
      return String(time);
    };
    
    switch (row.event) {
      case 'ENTERQUEUE':
        calls[row.callid].clientNumber = row.data2;
        calls[row.callid].queuePosition = row.data3;
        calls[row.callid].startTime = timeToString(row.time);
        break;
      case 'CONNECT':
        calls[row.callid].connectTime = timeToString(row.time);
        calls[row.callid].agent = row.data1;
        break;
      case 'COMPLETECALLER':
      case 'COMPLETEAGENT':
        calls[row.callid].endTime = timeToString(row.time);
        calls[row.callid].status = row.event === 'COMPLETECALLER' 
          ? 'completed_by_caller' 
          : 'completed_by_agent';
        calls[row.callid].duration = row.data2;
        break;
      case 'ABANDON':
        calls[row.callid].endTime = timeToString(row.time);
        calls[row.callid].waitTime = row.data3;
        calls[row.callid].status = 'abandoned';
        break;
    }
  });

  return Object.values(calls);
}

// Функция получения входящих звонков из CDR
async function getInboundCalls(conn, startTime, endTime) {
  // Входящие звонки: звонок от длинного номера (src > 4) на короткий номер (dst <= 4)
  // Логика: длинный номер (источник, внешний) -> короткий номер (назначение, внутренний)
  // ОПТИМИЗАЦИЯ: убрали LENGTH(TRIM(...)) из WHERE для использования индексов
  const minLength = CALL_FILTER_CONFIG.outboundMinLength;
  const [rows] = await conn.execute(`
    SELECT 
      c.calldate, c.uniqueid, c.linkedid, c.src, c.dst, 
      c.disposition, c.billsec, c.duration, c.recordingfile,
      c.dcontext, c.channel, c.lastapp, c.lastdata
    FROM asteriskcdrdb.cdr c
    WHERE c.calldate >= ? 
      AND c.calldate <= ?
      AND c.src IS NOT NULL 
      AND c.src != ''
      AND c.dst IS NOT NULL 
      AND c.dst != ''
      AND CHAR_LENGTH(c.src) > ?
      AND CHAR_LENGTH(c.dst) <= ?
    ORDER BY c.calldate DESC
  `, [startTime, endTime, minLength, minLength]);

  // Функция для преобразования времени в строку
  const timeToString = (time) => {
    if (!time) return null;
    if (typeof time === 'string') return time;
    if (time instanceof Date) {
      const year = time.getFullYear();
      const month = String(time.getMonth() + 1).padStart(2, '0');
      const day = String(time.getDate()).padStart(2, '0');
      const hours = String(time.getHours()).padStart(2, '0');
      const minutes = String(time.getMinutes()).padStart(2, '0');
      const seconds = String(time.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    }
    return String(time);
  };
  
  return rows.map(row => {
    // Нормализуем disposition (убираем пробелы и приводим к верхнему регистру)
    const disposition = (row.disposition || '').trim().toUpperCase().replace(/\s+/g, '');
    
    let status;
    if (disposition === 'ANSWERED') {
      status = 'answered';
    } else if (disposition === 'NOANSWER') {
      status = 'no_answer';
    } else if (disposition === 'BUSY') {
      status = 'busy';
    } else if (disposition === 'FAILED') {
      status = 'failed';
    } else {
      status = 'unknown';
    }
    
    return {
      callId: row.uniqueid,
      linkedid: row.linkedid,
      clientNumber: row.src,
      destination: row.dst,
      startTime: timeToString(row.calldate),
      endTime: timeToString(row.calldate),
      status: status,
      duration: row.billsec || 0,
      waitTime: null,
      recordingFile: row.recordingfile,
      dcontext: row.dcontext,
      channel: row.channel,
      isOutbound: false // Все звонки из getInboundCalls - входящие
    };
  });
}

// Функция получения исходящих звонков из CDR
async function getOutboundCalls(conn, startTime, endTime) {
  // Исходящие звонки определяются по полю outbound_cnum (как в PHP версии)
  // Условия: LENGTH(outbound_cnum) >= 4 AND lastapp != 'Hangup'
  // ДОПОЛНИТЕЛЬНО: исключаем внутренние звонки (dst <= 4) - исходящие должны быть на длинные номера
  // ОПТИМИЗАЦИЯ: убрали LENGTH(TRIM(...)) из WHERE для использования индексов
  const minLength = CALL_FILTER_CONFIG.outboundMinLength;
  // Определяем функцию для выполнения запроса
  // Если conn - это connection объект с методом execute, используем его
  // Иначе используем dbExecute из db-optimizer
  const executeFn = (conn && typeof conn.execute === 'function') 
    ? conn.execute.bind(conn) 
    : dbExecute;
  const [rows] = await executeFn(`
    SELECT 
      c.calldate, c.uniqueid, c.linkedid, c.src, c.dst, 
      c.disposition, c.billsec, c.duration, c.recordingfile,
      c.dcontext, c.channel, c.lastapp, c.lastdata,
      c.outbound_cnum, c.cnum
    FROM asteriskcdrdb.cdr c
    WHERE c.calldate >= ? 
      AND c.calldate <= ?
      AND c.outbound_cnum IS NOT NULL 
      AND c.outbound_cnum != ''
      AND CHAR_LENGTH(c.outbound_cnum) >= ?
      AND (c.lastapp IS NULL OR c.lastapp != 'Hangup')
      AND c.dst IS NOT NULL
      AND c.dst != ''
      AND CHAR_LENGTH(c.dst) > ?
    ORDER BY c.calldate DESC
  `, [startTime, endTime, minLength, minLength]);

  return rows.map(row => {
    // Нормализуем disposition (убираем пробелы и приводим к верхнему регистру)
    const disposition = (row.disposition || '').trim().toUpperCase().replace(/\s+/g, '');
    
    let status;
    if (disposition === 'ANSWERED') {
      status = 'answered';
    } else if (disposition === 'NOANSWER') {
      status = 'no_answer';
    } else if (disposition === 'BUSY') {
      status = 'busy';
    } else if (disposition === 'FAILED') {
      status = 'failed';
    } else {
      status = 'unknown';
    }
    
    // Функция для преобразования времени в строку
    const timeToString = (time) => {
      if (!time) return null;
      if (typeof time === 'string') return time;
      if (time instanceof Date) {
        const year = time.getFullYear();
        const month = String(time.getMonth() + 1).padStart(2, '0');
        const day = String(time.getDate()).padStart(2, '0');
        const hours = String(time.getHours()).padStart(2, '0');
        const minutes = String(time.getMinutes()).padStart(2, '0');
        const seconds = String(time.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
      return String(time);
    };
    
    // Для исходящих звонков: isOutbound = true
    // Это поможет правильно отобразить номер абонента (destination вместо clientNumber)
    return {
      callId: row.uniqueid,
      linkedid: row.linkedid,
      clientNumber: row.src,
      destination: row.dst,
      startTime: timeToString(row.calldate),
      endTime: timeToString(row.calldate),
      status: status,
      duration: row.billsec || 0,
      waitTime: null,
      recordingFile: row.recordingfile,
      dcontext: row.dcontext,
      channel: row.channel,
      isOutbound: true, // Все звонки из getOutboundCalls - исходящие
      outbound_cnum: row.outbound_cnum,
      cnum: row.cnum
    };
  });
}

/**
 * Получить список внутренних номеров (агентов) из очереди
 * Агенты берутся из таблицы asterisk.queues_details, где id = номер очереди
 * keyword = 'member', data имеет формат "Local/1006@from-queue/n,0"
 * Нужно извлечь номер (1006) из строки
 */
async function getQueueAgents(conn, queueName, startTime, endTime) {
  const executeFn = (conn && typeof conn.execute === 'function') 
    ? conn.execute.bind(conn) 
    : dbExecute;
  
  const [rows] = await executeFn(`
    SELECT DISTINCT data as member
    FROM asterisk.queues_details
    WHERE id = ? AND keyword = 'member'
  `, [queueName]);
  
  // Извлекаем номер из формата "Local/1006@from-queue/n,0"
  const agents = rows.map(row => {
    const member = String(row.member || '').trim();
    // Ищем паттерн: Local/НОМЕР@
    const match = member.match(/Local\/(\d+)@/);
    if (match && match[1]) {
      return match[1];
    }
    return null;
  }).filter(agent => agent && agent.length >= 3 && agent.length <= 5);
  
  return [...new Set(agents)]; // Убираем дубликаты
}

/**
 * Получить исходящие звонки от внутренних номеров из очереди
 * (Fallback функция, когда USE_ULTRA_FAST_QUERIES = false)
 */
async function getOutboundQueueCalls(conn, queueName, startTime, endTime) {
  // Сначала получаем список внутренних номеров (агентов) из очереди
  const agents = await getQueueAgents(conn, queueName, startTime, endTime);
  
  if (!agents || agents.length === 0) {
    console.log(`[getOutboundQueueCalls] Не найдено агентов в очереди ${queueName} за период ${startTime} - ${endTime}`);
    return [];
  }
  
  console.log(`[getOutboundQueueCalls] Найдено ${agents.length} агентов в очереди ${queueName}: ${agents.slice(0, 5).join(', ')}${agents.length > 5 ? '...' : ''}`);
  
  // Теперь получаем исходящие звонки от этих внутренних номеров
  const executeFn = (conn && typeof conn.execute === 'function') 
    ? conn.execute.bind(conn) 
    : dbExecute;
  
  const minLength = CALL_FILTER_CONFIG.outboundMinLength;
  
  // Создаем плейсхолдеры для IN clause
  const placeholders = agents.map(() => '?').join(',');
  
  const [rows] = await executeFn(`
    SELECT 
      c.calldate, c.uniqueid, c.linkedid, c.src, c.dst, 
      c.disposition, c.billsec, c.duration, c.recordingfile,
      c.dcontext, c.channel, c.lastapp, c.lastdata,
      c.outbound_cnum, c.cnum
    FROM asteriskcdrdb.cdr c
    WHERE c.calldate >= ? 
      AND c.calldate <= ?
      AND c.src IN (${placeholders})
      AND c.outbound_cnum IS NOT NULL 
      AND c.outbound_cnum != ''
      AND CHAR_LENGTH(c.outbound_cnum) >= ?
      AND (c.lastapp IS NULL OR c.lastapp != 'Hangup')
      AND c.dst IS NOT NULL
      AND c.dst != ''
      AND CHAR_LENGTH(c.dst) > ?
    ORDER BY c.calldate DESC
  `, [startTime, endTime, ...agents, minLength, minLength]);
  
  return rows.map(row => {
    // Нормализуем disposition (убираем пробелы и приводим к верхнему регистру)
    const disposition = (row.disposition || '').trim().toUpperCase().replace(/\s+/g, '');
    
    let status;
    if (disposition === 'ANSWERED') {
      status = 'answered';
    } else if (disposition === 'NOANSWER') {
      status = 'no_answer';
    } else if (disposition === 'BUSY') {
      status = 'busy';
    } else if (disposition === 'FAILED') {
      status = 'failed';
    } else {
      status = 'unknown';
    }
    
    // Функция для преобразования времени в строку
    const timeToString = (time) => {
      if (!time) return null;
      if (typeof time === 'string') return time;
      if (time instanceof Date) {
        const year = time.getFullYear();
        const month = String(time.getMonth() + 1).padStart(2, '0');
        const day = String(time.getDate()).padStart(2, '0');
        const hours = String(time.getHours()).padStart(2, '0');
        const minutes = String(time.getMinutes()).padStart(2, '0');
        const seconds = String(time.getSeconds()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
      return String(time);
    };
    
    return {
      callId: row.uniqueid,
      linkedid: row.linkedid,
      clientNumber: row.outbound_cnum || row.src, // Для исходящих: clientNumber = outbound_cnum или src
      destination: row.dst,
      startTime: timeToString(row.calldate),
      endTime: timeToString(row.calldate),
      status: status,
      duration: row.billsec || 0,
      waitTime: null,
      recordingFile: row.recordingfile,
      dcontext: row.dcontext,
      channel: row.channel,
      isOutbound: true, // Все звонки из getOutboundQueueCalls - исходящие
      outbound_cnum: row.outbound_cnum,
      cnum: row.cnum
    };
  });
}

// Функция checkCallbacksBatch перенесена в callback-checker.js
// Используется импорт из модуля выше
// Старая функция удалена - теперь используется общий модуль

// Функция checkCallbacksBatchInbound также перенесена в callback-checker.js
// Старая функция удалена - теперь используется общий модуль

// Функция проверки перезвонов (старая версия, оставлена для совместимости)
async function checkCallbacks(conn, call, queueName) {
  // Проверяем только пропущенные звонки
  // Звонок считается пропущенным если:
  // 1. status === 'abandoned'
  // 2. duration <= 5 секунд
  // 3. Нет connectTime (не был принят)
  const isAbandoned = call.status === 'abandoned' || 
                      (call.duration && parseInt(call.duration) <= 5) ||
                      (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller');
  
  // Если звонок не пропущенный, не проверяем перезвоны
  if (!isAbandoned) {
    return null;
  }
  
  // Проверяем наличие обязательных данных для поиска перезвонов
  if (!call.clientNumber || !call.startTime) {
    // Даже если нет данных для поиска, помечаем как "Не обработан"
    return {
      type: 'no_callback',
      status: 'Не обработан',
      callbackTime: null,
      recordingFile: null
    };
  }

  // Временной интервал поиска (2 часа после пропущенного звонка)
  const callbackHours = 2;
  const callbackStartTime = new Date(new Date(call.startTime).getTime() + 1000); // +1 секунда
  const callbackEndTime = new Date(new Date(call.startTime).getTime() + callbackHours * 3600 * 1000);
  
  const callbackStartStr = format(callbackStartTime, 'yyyy-MM-dd HH:mm:ss');
  const callbackEndStr = format(callbackEndTime, 'yyyy-MM-dd HH:mm:ss');
  
  // Берем номер для поиска - нормализуем номер
  const clientNumberStr = call.clientNumber.toString().trim();
  const clientNumberLast10 = clientNumberStr.slice(-10);
  const clientNumberLast9 = clientNumberStr.slice(-9);
  
  if (process.env.DEBUG === 'true') {
    console.log(`[checkCallbacks] Проверка перезвонов для звонка ${call.callId}:`);
    console.log(`  Номер: ${clientNumberStr} (последние 10: ${clientNumberLast10}, последние 9: ${clientNumberLast9})`);
    console.log(`  Период поиска: ${callbackStartStr} - ${callbackEndStr}`);
  }

  try {
    // Проверка 1: Перезвонил сам (входящий звонок от клиента)
    // СНАЧАЛА проверяем в той же очереди (queuelog + cdr)
    // Если не найдено, тогда ищем во всей базе CDR
    let clientCallbackRows = [];
    
    // 1.1. Ищем в той же очереди
    // ВАЖНО: Номер клиента находится в ENTERQUEUE (data2), а не в COMPLETECALLER/COMPLETEAGENT
    // Поэтому делаем JOIN с ENTERQUEUE событием для получения номера клиента
    // ВАЖНО: Исключаем оригинальный звонок (q.callid != call.callId)
    const [queueCallbackRows] = await conn.execute(`
      SELECT 
        q.time, q.event, q.callid, q.queuename,
        c.calldate, c.uniqueid, c.billsec, c.disposition,
        c.recordingfile, c.src, c.dst,
        e.data2 as clientNumber
      FROM asteriskcdrdb.queuelog q
      INNER JOIN asteriskcdrdb.queuelog e ON q.callid = e.callid AND e.event = 'ENTERQUEUE'
      INNER JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid
      WHERE q.queuename = ?
        AND q.time >= ? 
        AND q.time <= ?
        AND q.event IN ('COMPLETECALLER', 'COMPLETEAGENT')
        AND c.disposition = 'ANSWERED'
        AND c.billsec >= 5
        AND q.callid != ?
        AND (
          e.data2 LIKE ? OR e.data2 LIKE ? OR 
          RIGHT(e.data2, 10) = ? OR RIGHT(e.data2, 9) = ? OR
          e.data2 = ?
        )
      ORDER BY q.time ASC
      LIMIT 1
    `, [queueName, callbackStartStr, callbackEndStr, call.callId, `%${clientNumberLast10}`, `%${clientNumberLast9}`, clientNumberLast10, clientNumberLast9, clientNumberStr]);
    
    if (queueCallbackRows && queueCallbackRows.length > 0) {
      clientCallbackRows = queueCallbackRows;
      if (process.env.DEBUG === 'true') {
        console.log(`[checkCallbacks] ✅ Найден перезвон в очереди для ${call.callId}`);
      }
    } else {
      // 1.2. Если не найдено в очереди, ищем во всей базе CDR
      // ВАЖНО: ищем только ВХОДЯЩИЕ звонки (исключаем исходящие)
      const [cdrCallbackRows] = await conn.execute(`
        SELECT 
          c.calldate, c.uniqueid, c.billsec, c.disposition,
          c.recordingfile, c.src, c.dst, c.dcontext
        FROM asteriskcdrdb.cdr c
        WHERE c.calldate >= ? 
          AND c.calldate <= ?
          AND c.disposition = 'ANSWERED'
          AND c.billsec >= 5
          AND (
            c.src LIKE ? OR c.src LIKE ? OR 
            RIGHT(c.src, 10) = ? OR RIGHT(c.src, 9) = ? OR
            c.src = ?
          )
          AND c.dcontext NOT LIKE 'outbound%'
          AND c.dcontext NOT LIKE 'from-internal%'
          AND c.dcontext NOT LIKE 'ext-local%'
        ORDER BY c.calldate ASC
        LIMIT 1
      `, [callbackStartStr, callbackEndStr, `%${clientNumberLast10}`, `%${clientNumberLast9}`, clientNumberLast10, clientNumberLast9, clientNumberStr]);
      
      if (cdrCallbackRows && cdrCallbackRows.length > 0) {
        clientCallbackRows = cdrCallbackRows;
        if (process.env.DEBUG === 'true') {
          console.log(`[checkCallbacks] ✅ Найден перезвон в CDR (не в очереди) для ${call.callId}`);
        }
      }
    }

    if (clientCallbackRows && clientCallbackRows.length > 0) {
      const callback = clientCallbackRows[0];
      if (process.env.DEBUG === 'true') {
        console.log(`[checkCallbacks] ✅ Найден перезвон от клиента для ${call.callId}:`);
        console.log(`  callback.uniqueid: ${callback.uniqueid}`);
        console.log(`  callback.src: ${callback.src}`);
        console.log(`  callback.calldate: ${callback.calldate}`);
        console.log(`  callback.billsec: ${callback.billsec}`);
        console.log(`  callback.disposition: ${callback.disposition}`);
      }
      
      if (callback.disposition === 'ANSWERED' && callback.billsec >= 5) {
        return {
          type: 'client_callback',
          status: 'Перезвонил сам',
          callbackTime: callback.calldate,
          recordingFile: callback.recordingfile || call.recordingFile
        };
      }
    } else {
      if (process.env.DEBUG === 'true') {
        console.log(`[checkCallbacks] ❌ Перезвон от клиента не найден для ${call.callId}`);
      }
    }

    // Проверка 2: Перезвонили мы (исходящий звонок к клиенту)
    // Ищем ВСЕ успешно отвеченные исходящие звонки к этому номеру в течение 2 часов
    const [agentCallbackRows] = await conn.execute(`
      SELECT 
        c.calldate, c.uniqueid, c.billsec, c.disposition,
        c.recordingfile, c.src, c.dst, c.dcontext
      FROM asteriskcdrdb.cdr c
      WHERE c.calldate >= ? 
        AND c.calldate <= ?
        AND c.disposition = 'ANSWERED'
        AND c.billsec >= 5
        AND (
          c.dst LIKE ? OR c.dst LIKE ? OR 
          RIGHT(c.dst, 10) = ? OR RIGHT(c.dst, 9) = ? OR
          c.dst = ?
        )
      ORDER BY c.calldate ASC
      LIMIT 1
    `, [callbackStartStr, callbackEndStr, `%${clientNumberLast10}`, `%${clientNumberLast9}`, clientNumberLast10, clientNumberLast9, clientNumberStr]);

    if (agentCallbackRows && agentCallbackRows.length > 0) {
      const callback = agentCallbackRows[0];
      if (process.env.DEBUG === 'true') {
        console.log(`[checkCallbacks] ✅ Найден перезвон от агента для ${call.callId}:`);
        console.log(`  callback.uniqueid: ${callback.uniqueid}`);
        console.log(`  callback.dst: ${callback.dst}`);
        console.log(`  callback.calldate: ${callback.calldate}`);
        console.log(`  callback.billsec: ${callback.billsec}`);
      }
      
      if (callback.disposition === 'ANSWERED' && callback.billsec >= 5) {
        return {
          type: 'agent_callback',
          status: 'Перезвонили мы',
          callbackTime: callback.calldate,
          recordingFile: callback.recordingfile || call.recordingFile
        };
      }
    } else {
      if (process.env.DEBUG === 'true') {
        console.log(`[checkCallbacks] ❌ Перезвон от агента не найден для ${call.callId}`);
      }
    }
    
    // Не обработан - не нашли ни перезвон от клиента, ни от агента
    if (process.env.DEBUG === 'true') {
      console.log(`[checkCallbacks] ⏸️ Не обработан для ${call.callId} - перезвонов не найдено`);
    }
    return {
      type: 'no_callback',
      status: 'Не обработан',
      callbackTime: null,
      recordingFile: null
    };
  } catch (error) {
    console.error('Ошибка при проверке перезвонов для звонка', call.callId, ':', error);
    // При ошибке возвращаем "Не обработан" вместо null, чтобы статус был установлен
    return {
      type: 'no_callback',
      status: 'Не обработан',
      callbackTime: null,
      recordingFile: null
    };
  }
}

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
        console.log(`[DEBUG Hour] call.startTime:`, call.startTime, 'type:', typeof call.startTime, 'toString:', str);
      }
      
      // Ищем час в формате "HH:MM" или "YYYY-MM-DD HH:MM:SS"
      const match = str.match(/(\d{2}):(\d{2})/);
      const hour = match ? parseInt(match[1], 10) : 0;
      
      if (process.env.DEBUG_HOURS === 'true' && idx < 3) {
        console.log(`[DEBUG Hour] extracted hour:`, hour, 'from match:', match);
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
  
  console.log('Статистика перезвонов:', {
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
    console.log('📧 Ежедневные email отчеты отключены (нет конфигурации SMTP)');
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
      console.log('📧 Начало генерации ежедневных отчетов по очередям...');
      
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
      
      console.log(`📧 Генерация отчета за ${todayStr} ${timezone} (UTC+${offsetHours})`);
      console.log(`📧 Диапазон запроса в UTC: ${startTimeUTC} - ${endTimeUTC}`);
      
      // Получаем список всех очередей с активными email адресами
      const queuesWithEmails = await settingsDb.getAll(`
        SELECT DISTINCT queue_name
        FROM email_reports
        WHERE is_active = 1
      `);
      
      if (!queuesWithEmails || queuesWithEmails.length === 0) {
        console.log('📧 Нет очередей с активными email адресами для отправки отчетов');
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
          console.log(`📧 Генерация отчета для очереди ${queueName}...`);
          // Передаем дату отчета (в локальном TZ) и диапазон времени в UTC для запросов
          const reportData = await generateQueueReport(currentPool, queueName, todayStr, startTimeUTC, endTimeUTC, callFunctions);
          const result = await sendQueueReport(reportData, queueName, currentPool);
          
          if (result.success) {
            console.log(`✅ Отчет для очереди ${queueName} успешно отправлен`);
            return { success: true, queueName };
          } else {
            console.error(`❌ Ошибка отправки отчета для очереди ${queueName}:`, result.error);
            return { success: false, queueName, error: result.error };
          }
        } catch (error) {
          console.error(`❌ Ошибка при генерации/отправке отчета для очереди ${queueName}:`, error);
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
          console.error(`❌ Ошибка при обработке очереди ${queuesWithEmails[idx].queue_name}:`, result.reason);
        }
      });
      
      console.log(`📧 Итоги отправки отчетов: успешно ${successCount}, ошибок ${errorCount}`);
    } catch (error) {
      console.error('❌ Ошибка при генерации/отправке ежедневных отчетов:', error);
    }
  }, {
    scheduled: true,
    timezone: getTimezone()
  });

  console.log(`📧 Ежедневные email отчеты настроены. Расписание: ${cronSchedule} (${getTimezone()})`);
  console.log('📧 Отчеты будут отправляться для каждой очереди отдельно на указанные email адреса');
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
    console.error('Ошибка получения названий очередей:', error);
    res.status(500).json({ error: error.message });
  }
});

// Запуск сервера
// Убеждаемся, что все кэши загружены ПЕРЕД тем, как сервер начнет принимать запросы
let serverReady = false;

// Сначала инициализируем адаптер БД, затем приложение
initializeDatabaseAdapter()
  .then(() => initializeApp())
  .then(() => {
    serverReady = true;
  app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Конфигурация фильтрации: минимальная длина номера для исходящих = ${CALL_FILTER_CONFIG.outboundMinLength}`);
    
    // Инициализируем отправку email отчетов
    initializeEmailReports();
  });
  })
  .catch(err => {
  console.error('Ошибка при инициализации:', err);
    // Запускаем сервер даже при ошибке, но с предупреждением
    serverReady = true;
    app.listen(PORT, () => {
      console.log(`⚠️ Сервер запущен с ошибками инициализации на http://localhost:${PORT}`);
    });
});