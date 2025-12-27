require('dotenv').config();
const express = require('express');
const { format, subDays } = require('date-fns');
const path = require('path');
const fs = require('fs');
const compression = require('compression');

// Используем оптимизированный модуль для работы с БД (аналог PDO в PHP)
// Кэширует prepared statements и оптимизирует запросы
const { pool, execute: dbExecute, getPoolStats } = require('./db-optimizer');

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

// Ультра-оптимизированные запросы (самые быстрые)
const {
  getQueueCallsUltraFast
} = require('./db-optimized-queue');

// Модуль рейтингов очередей
const {
  getQueueRankings,
  getTopQueues
} = require('./queue-rankings');

// Флаги использования оптимизаций
const USE_ULTRA_FAST_QUERIES = process.env.USE_ULTRA_FAST_QUERIES !== 'false'; // По умолчанию включено (самый быстрый)
const USE_PARALLEL_QUERIES = process.env.USE_PARALLEL_QUERIES !== 'false';
const USE_LARGE_DATA_OPTIMIZATION = process.env.USE_LARGE_DATA_OPTIMIZATION === 'true';

const app = express();
const PORT = process.env.PORT || 3000;

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
    const date = new Date(timeStr);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  },
  formatShortDate: (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit'
    });
  },
  formatDateTime: (dateStr) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
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
  await refreshQueuesCache();
  await refreshQueueNamesCache();
  
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
  const now = Date.now();
  if (now - queueNamesCacheTime > QUEUES_CACHE_TTL || Object.keys(queueNamesCache).length === 0) {
    // Асинхронно обновляем кэш, но возвращаем текущее значение
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
    title: 'Анализатор очередей Asterisk',
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
// API для управления email адресами
// ==========================================

// Получить все email адреса для очереди
app.get('/api/email-reports/:queueName', async (req, res) => {
  try {
    const { queueName } = req.params;
    const [rows] = await dbExecute(`
      SELECT id, queue_name, email, is_active, created_at, updated_at
      FROM asteriskcdrdb.email_reports
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
    const [rows] = await dbExecute(`
      SELECT id, queue_name, email, is_active, created_at, updated_at
      FROM asteriskcdrdb.email_reports
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
    
    const [result] = await dbExecute(`
      INSERT INTO asteriskcdrdb.email_reports (queue_name, email, is_active)
      VALUES (?, ?, TRUE)
      ON DUPLICATE KEY UPDATE is_active = TRUE, updated_at = CURRENT_TIMESTAMP
    `, [queue_name, email]);
    
    res.json({ 
      success: true, 
      message: 'Email адрес успешно добавлен',
      id: result.insertId 
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
    
    await dbExecute(`
      UPDATE asteriskcdrdb.email_reports
      SET is_active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [is_active === true || is_active === 'true', id]);
    
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
    
    await dbExecute(`
      DELETE FROM asteriskcdrdb.email_reports
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
      getInboundCalls,
      getOutboundCalls,
      checkCallbacksBatch,
      checkCallbacksBatchInbound,
      calculateStats
    };
    
    if (queue_name) {
      // Отправка отчета для конкретной очереди
      console.log(`📧 Генерация отчета для очереди ${queue_name} за ${reportDate}...`);
      const reportData = await generateQueueReport(pool, queue_name, reportDate, callFunctions);
      const result = await sendQueueReport(reportData, queue_name, pool);
      
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
      if (USE_LARGE_DATA_OPTIMIZATION) {
        calls = await getInboundCallsOptimized(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else if (USE_PARALLEL_QUERIES) {
        calls = await getInboundCallsParallel(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else {
        calls = await getInboundCalls(pool, startTime, endTime);
      }
    } else if (viewType === 'outbound') {
      if (USE_PARALLEL_QUERIES) {
        calls = await getOutboundCallsParallel(startTime, endTime, CALL_FILTER_CONFIG.outboundMinLength);
      } else {
        calls = await getOutboundCalls(pool, startTime, endTime);
      }
    } else if (viewType === 'outbound_queue') {
      // viewType === 'outbound_queue' - исходящие очереди
      // Получаем исходящие звонки от внутренних номеров, которые работают в этой очереди
      if (USE_ULTRA_FAST_QUERIES) {
        // Самый быстрый метод: получаем агентов, затем CDR отдельным запросом
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
        calls = await getQueueCalls(pool, queue_name, startTime, endTime);
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
        }
      });
      
      // Оптимизированная проверка перезвонов - batch-запрос
      if (abandonedCalls.length > 0) {
        const callbacks = await checkCallbacksBatch(pool, abandonedCalls.map(ac => ac.call), queue_name);
        
        // Применяем результаты (оптимизировано)
        callbacks.forEach((callback, idx) => {
          const { index } = abandonedCalls[idx];
          if (callback) {
            calls[index].callback = callback;
            calls[index].callbackStatus = callback.status;
            callbackCheckCount++;
            if (callback.recordingFile) {
              calls[index].recordingFile = callback.recordingFile;
            }
          } else {
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
        }
      });
      
      // Проверка перезвонов для исходящих очередей (используем ту же логику, что и для входящих)
      if (abandonedCalls.length > 0) {
        const callbacks = await checkCallbacksBatchInbound(pool, abandonedCalls.map(ac => ac.call));
        
        // Применяем результаты (оптимизировано)
        callbacks.forEach((callback, idx) => {
          const { index } = abandonedCalls[idx];
          if (callback) {
            calls[index].callback = callback;
            calls[index].callbackStatus = callback.status;
            callbackCheckCount++;
            if (callback.recordingFile) {
              calls[index].recordingFile = callback.recordingFile;
            }
          } else {
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
        // Для входящих: пропущенный = не отвечен (no_answer) или занято (busy) или неудачно (failed)
        const isAbandoned = call.status === 'no_answer' || 
                            call.status === 'busy' || 
                            call.status === 'failed' ||
                            (call.duration && parseInt(call.duration) <= 5);
        
        if (isAbandoned) {
          abandonedCount++;
          abandonedCalls.push({ index: i, call });
        }
      });
      
      // Проверка перезвонов для входящих звонков
      if (abandonedCalls.length > 0) {
        const callbacks = await checkCallbacksBatchInbound(pool, abandonedCalls.map(ac => ac.call));
        
        // Применяем результаты (оптимизировано)
        callbacks.forEach((callback, idx) => {
          const { index } = abandonedCalls[idx];
          if (callback) {
            calls[index].callback = callback;
            calls[index].callbackStatus = callback.status;
            callbackCheckCount++;
            if (callback.recordingFile) {
              calls[index].recordingFile = callback.recordingFile;
            }
          } else {
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
    
    switch (row.event) {
      case 'ENTERQUEUE':
        calls[row.callid].clientNumber = row.data2;
        calls[row.callid].queuePosition = row.data3;
        calls[row.callid].startTime = row.time;
        break;
      case 'CONNECT':
        calls[row.callid].connectTime = row.time;
        calls[row.callid].agent = row.data1;
        break;
      case 'COMPLETECALLER':
      case 'COMPLETEAGENT':
        calls[row.callid].endTime = row.time;
        calls[row.callid].status = row.event === 'COMPLETECALLER' 
          ? 'completed_by_caller' 
          : 'completed_by_agent';
        calls[row.callid].duration = row.data2;
        break;
      case 'ABANDON':
        calls[row.callid].endTime = row.time;
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
      startTime: row.calldate,
      endTime: row.calldate,
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
    
    // Для исходящих звонков: isOutbound = true
    // Это поможет правильно отобразить номер абонента (destination вместо clientNumber)
    return {
      callId: row.uniqueid,
      linkedid: row.linkedid,
      clientNumber: row.src,
      destination: row.dst,
      startTime: row.calldate,
      endTime: row.calldate,
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
 * Оптимизированная версия получения исходящих звонков очереди (UltraFast)
 * Стратегия: получаем агентов, затем CDR отдельным запросом без JOIN
 */
async function getOutboundQueueCallsUltraFast(queueName, startTime, endTime) {
  const startTotal = Date.now();
  
  // Шаг 1: Получаем список агентов из очереди
  const start1 = Date.now();
  const agents = await getQueueAgents(null, queueName, startTime, endTime);
  const time1 = Date.now() - start1;
  
  if (!agents || agents.length === 0) {
    console.log(`[getOutboundQueueCallsUltraFast] Не найдено агентов в очереди ${queueName}`);
    return [];
  }
  
  console.log(`[getOutboundQueueCallsUltraFast] Найдено ${agents.length} агентов: ${agents.slice(0, 5).join(', ')}${agents.length > 5 ? '...' : ''}`);
  
  // Шаг 2: Получаем все исходящие звонки от этих агентов одним запросом
  const start2 = Date.now();
  const minLength = CALL_FILTER_CONFIG.outboundMinLength;
  const placeholders = agents.map(() => '?').join(',');
  
  const [rows] = await dbExecute(`
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
  const time2 = Date.now() - start2;
  
  // Шаг 3: Обрабатываем результаты в памяти (быстро)
  const start3 = Date.now();
  const calls = rows.map(row => {
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
      clientNumber: row.outbound_cnum || row.src, // Для исходящих: clientNumber = outbound_cnum или src
      destination: row.dst,
      startTime: row.calldate,
      endTime: row.calldate,
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
  const time3 = Date.now() - start3;
  const totalTime = Date.now() - startTotal;
  
  if (process.env.DEBUG_DB === 'true') {
    console.log(`[UltraFast Outbound Queue] Получение агентов: ${time1}ms, запрос CDR: ${time2}ms, обработка: ${time3}ms, всего: ${totalTime}ms, найдено звонков: ${calls.length}`);
  }
  
  return calls;
}

/**
 * Получить исходящие звонки от внутренних номеров из очереди
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
    
    return {
      callId: row.uniqueid,
      linkedid: row.linkedid,
      clientNumber: row.outbound_cnum || row.src, // Для исходящих: clientNumber = outbound_cnum или src
      destination: row.dst,
      startTime: row.calldate,
      endTime: row.calldate,
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

// ОПТИМИЗИРОВАННАЯ функция batch-проверки перезвонов для всех звонков сразу
async function checkCallbacksBatch(conn, calls, queueName) {
  if (!calls || calls.length === 0) {
    return [];
  }

  // Инициализируем результаты как "Не обработан"
  const results = calls.map(() => ({
    type: 'no_callback',
    status: 'Не обработан',
    callbackTime: null,
    recordingFile: null
  }));

  // Фильтруем только звонки с необходимыми данными
  const validCalls = calls
    .map((call, idx) => {
      const isAbandoned = call.status === 'abandoned' || 
                          (call.duration && parseInt(call.duration) <= 5) ||
                          (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller');
      
      if (!isAbandoned || !call.clientNumber || !call.startTime) {
        return null;
      }

      const callbackStartTime = new Date(new Date(call.startTime).getTime() + 1000);
      const callbackEndTime = new Date(new Date(call.startTime).getTime() + 2 * 3600 * 1000);
      const clientNumberStr = call.clientNumber.toString().trim();
      return {
        originalIndex: idx,
        callId: call.callId,
        clientNumber: clientNumberStr,
        clientNumberLast10: clientNumberStr.slice(-10),
        clientNumberLast9: clientNumberStr.slice(-9),
        callbackStart: format(callbackStartTime, 'yyyy-MM-dd HH:mm:ss'),
        callbackEnd: format(callbackEndTime, 'yyyy-MM-dd HH:mm:ss'),
        call: call
      };
    })
    .filter(vc => vc !== null);

  if (validCalls.length === 0) {
    return results;
  }

  try {
    // Определяем функцию для выполнения запроса
    // Если conn - это connection объект с методом execute, используем его
    // Иначе используем dbExecute из db-optimizer
    const executeFn = (conn && typeof conn.execute === 'function') 
      ? conn.execute.bind(conn) 
      : dbExecute;

    // 1. Batch-запрос для поиска перезвонов в очереди (client callbacks)
    const [queueCallbacks] = await executeFn(`
      SELECT 
        q.time, q.event, q.callid, q.queuename,
        c.calldate, c.uniqueid, c.billsec, c.disposition,
        c.recordingfile, c.src, c.dst,
        e.data2 as clientNumber,
        q.callid as matched_callid
      FROM asteriskcdrdb.queuelog q
      INNER JOIN asteriskcdrdb.queuelog e ON q.callid = e.callid AND e.event = 'ENTERQUEUE'
      INNER JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid
      WHERE q.queuename = ?
        AND q.event IN ('COMPLETECALLER', 'COMPLETEAGENT')
        AND c.disposition = 'ANSWERED'
        AND c.billsec >= 5
        AND (
          ${validCalls.map((vc, idx) => `
            (q.time >= ? AND q.time <= ? AND q.callid != ? AND (
              e.data2 LIKE ? OR e.data2 LIKE ? OR 
              RIGHT(e.data2, 10) = ? OR RIGHT(e.data2, 9) = ? OR
              e.data2 = ?
            ))
          `).join(' OR ')}
        )
      ORDER BY q.time ASC
    `, [queueName, ...validCalls.flatMap(vc => [
      vc.callbackStart, vc.callbackEnd, vc.callId,
      `%${vc.clientNumberLast10}`, `%${vc.clientNumberLast9}`,
      vc.clientNumberLast10, vc.clientNumberLast9, vc.clientNumber
    ])]);

    // Создаем мапу найденных перезвонов в очереди
    const queueCallbackMap = new Map();
    queueCallbacks.forEach(cb => {
      // Находим соответствующий оригинальный звонок
      const matchedCall = validCalls.find(vc => {
        if (cb.time < vc.callbackStart || cb.time > vc.callbackEnd) return false;
        if (cb.callid === vc.callId) return false;
        
        // Проверяем совпадение номера
        const cbNumber = String(cb.clientNumber || '').trim();
        if (!cbNumber) return false;
        
        return cbNumber === vc.clientNumber ||
               cbNumber.slice(-10) === vc.clientNumberLast10 ||
               cbNumber.slice(-9) === vc.clientNumberLast9 ||
               vc.clientNumber.slice(-10) === cbNumber.slice(-10) ||
               vc.clientNumber.slice(-9) === cbNumber.slice(-9);
      });
      if (matchedCall && !queueCallbackMap.has(matchedCall.originalIndex)) {
        queueCallbackMap.set(matchedCall.originalIndex, cb);
      }
    });

    // 2. и 3. ПАРАЛЛЕЛЬНАЯ обработка: поиск перезвонов в CDR (клиент и агент одновременно)
    const callsWithoutQueueCallback = validCalls.filter(vc => !queueCallbackMap.has(vc.originalIndex));
    
    // Создаем Map для быстрого поиска по номеру и времени (оптимизация)
    const validCallsMap = new Map();
    validCalls.forEach(vc => {
      const key = `${vc.clientNumber}|${vc.callbackStart}|${vc.callbackEnd}`;
      if (!validCallsMap.has(key)) {
        validCallsMap.set(key, []);
      }
      validCallsMap.get(key).push(vc);
    });
    
    if (callsWithoutQueueCallback.length > 0) {
      // Параллельно выполняем оба запроса
      const [cdrClientCallbacks, cdrAgentCallbacks] = await Promise.all([
        // Запрос для перезвонов от клиента
        executeFn(`
          SELECT 
            c.calldate, c.uniqueid, c.billsec, c.disposition,
            c.recordingfile, c.src, c.dst, c.dcontext,
            c.src as matched_number
          FROM asteriskcdrdb.cdr c
          WHERE c.disposition = 'ANSWERED'
            AND c.billsec >= 5
            AND c.dcontext NOT LIKE 'outbound%'
            AND c.dcontext NOT LIKE 'from-internal%'
            AND c.dcontext NOT LIKE 'ext-local%'
            AND (
              ${callsWithoutQueueCallback.map((vc, idx) => `
                (c.calldate >= ? AND c.calldate <= ? AND (
                  c.src LIKE ? OR c.src LIKE ? OR 
                  RIGHT(c.src, 10) = ? OR RIGHT(c.src, 9) = ? OR
                  c.src = ?
                ))
              `).join(' OR ')}
            )
          ORDER BY c.calldate ASC
        `, callsWithoutQueueCallback.flatMap(vc => [
          vc.callbackStart, vc.callbackEnd,
          `%${vc.clientNumberLast10}`, `%${vc.clientNumberLast9}`,
          vc.clientNumberLast10, vc.clientNumberLast9, vc.clientNumber
        ])),
        // Запрос для перезвонов от агента
        executeFn(`
          SELECT 
            c.calldate, c.uniqueid, c.billsec, c.disposition,
            c.recordingfile, c.src, c.dst, c.dcontext,
            c.dst as matched_number
          FROM asteriskcdrdb.cdr c
          WHERE c.disposition = 'ANSWERED'
            AND c.billsec >= 5
            AND (
              ${callsWithoutQueueCallback.map((vc, idx) => `
                (c.calldate >= ? AND c.calldate <= ? AND (
                  c.dst LIKE ? OR c.dst LIKE ? OR 
                  RIGHT(c.dst, 10) = ? OR RIGHT(c.dst, 9) = ? OR
                  c.dst = ?
                ))
              `).join(' OR ')}
            )
          ORDER BY c.calldate ASC
        `, callsWithoutQueueCallback.flatMap(vc => [
          vc.callbackStart, vc.callbackEnd,
          `%${vc.clientNumberLast10}`, `%${vc.clientNumberLast9}`,
          vc.clientNumberLast10, vc.clientNumberLast9, vc.clientNumber
        ]))
      ]);

      // Оптимизированная обработка результатов с использованием Map
      const callsWithoutQueueCallbackMap = new Map();
      callsWithoutQueueCallback.forEach(vc => {
        callsWithoutQueueCallbackMap.set(vc.originalIndex, vc);
      });

      // Обработка перезвонов от клиента (приоритет)
      cdrClientCallbacks[0].forEach(cb => {
        const cbSrc = String(cb.src || '').trim();
        if (!cbSrc) return;
        
        // Быстрый поиск по Map
        callsWithoutQueueCallback.forEach(vc => {
          if (queueCallbackMap.has(vc.originalIndex)) return;
          if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return;
          
          const matches = cbSrc === vc.clientNumber ||
                       cbSrc.slice(-10) === vc.clientNumberLast10 ||
                       cbSrc.slice(-9) === vc.clientNumberLast9 ||
                       vc.clientNumber.slice(-10) === cbSrc.slice(-10) ||
                       vc.clientNumber.slice(-9) === cbSrc.slice(-9);
          
          if (matches && !queueCallbackMap.has(vc.originalIndex)) {
            queueCallbackMap.set(vc.originalIndex, cb);
          }
        });
      });

      // Обработка перезвонов от агента (только если не найден перезвон от клиента)
      const agentCallbackMap = new Map();
      cdrAgentCallbacks[0].forEach(cb => {
        const cbDst = String(cb.dst || '').trim();
        if (!cbDst) return;
        
        callsWithoutQueueCallback.forEach(vc => {
          if (queueCallbackMap.has(vc.originalIndex)) return;
          if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return;
          
          const matches = cbDst === vc.clientNumber ||
                         cbDst.slice(-10) === vc.clientNumberLast10 ||
                         cbDst.slice(-9) === vc.clientNumberLast9 ||
                         vc.clientNumber.slice(-10) === cbDst.slice(-10) ||
                         vc.clientNumber.slice(-9) === cbDst.slice(-9);
          
          if (matches && !agentCallbackMap.has(vc.originalIndex)) {
            agentCallbackMap.set(vc.originalIndex, cb);
          }
        });
      });

      // Применяем результаты перезвонов от агентов
      agentCallbackMap.forEach((cb, idx) => {
        if (!queueCallbackMap.has(idx)) {
          results[idx] = {
            type: 'agent_callback',
            status: 'Перезвонили мы',
            callbackTime: cb.calldate,
            recordingFile: cb.recordingfile || callsWithoutQueueCallbackMap.get(idx)?.call.recordingFile
          };
        }
      });
    }

    // Применяем результаты перезвонов от клиентов
    queueCallbackMap.forEach((cb, idx) => {
      const vc = validCalls.find(v => v.originalIndex === idx);
      if (vc) {
        results[idx] = {
          type: 'client_callback',
          status: 'Перезвонил сам',
          callbackTime: cb.calldate || cb.time,
          recordingFile: cb.recordingfile || vc.call.recordingFile
        };
      }
    });

  } catch (error) {
    console.error('Ошибка при batch-проверке перезвонов:', error);
    // В случае ошибки возвращаем "Не обработан" для всех
    return calls.map(() => ({
      type: 'no_callback',
      status: 'Не обработан',
      callbackTime: null,
      recordingFile: null
    }));
  }

  return results;
}

// Функция batch-проверки перезвонов для входящих звонков
async function checkCallbacksBatchInbound(conn, calls) {
  if (!calls || calls.length === 0) {
    return [];
  }

  // Инициализируем результаты как "Не обработан"
  const results = calls.map(() => ({
    type: 'no_callback',
    status: 'Не обработан',
    callbackTime: null,
    recordingFile: null
  }));

  // Фильтруем только пропущенные звонки с необходимыми данными
  const validCalls = calls
    .map((call, idx) => {
      // Для входящих: пропущенный = не отвечен (no_answer) или занято (busy) или неудачно (failed)
      const isAbandoned = call.status === 'no_answer' || 
                          call.status === 'busy' || 
                          call.status === 'failed' ||
                          (call.duration && parseInt(call.duration) <= 5);
      
      if (!isAbandoned || !call.clientNumber || !call.startTime) {
        return null;
      }

      const callbackStartTime = new Date(new Date(call.startTime).getTime() + 1000);
      const callbackEndTime = new Date(new Date(call.startTime).getTime() + 2 * 3600 * 1000);
      const clientNumberStr = call.clientNumber.toString().trim();
      return {
        originalIndex: idx,
        callId: call.callId,
        clientNumber: clientNumberStr,
        clientNumberLast10: clientNumberStr.slice(-10),
        clientNumberLast9: clientNumberStr.slice(-9),
        callbackStart: format(callbackStartTime, 'yyyy-MM-dd HH:mm:ss'),
        callbackEnd: format(callbackEndTime, 'yyyy-MM-dd HH:mm:ss'),
        call: call
      };
    })
    .filter(vc => vc !== null);

  if (validCalls.length === 0) {
    return results;
  }

  try {
    // 1. Batch-запрос для поиска перезвонов от клиента (входящие звонки в CDR)
    // Перезвон от клиента = входящий звонок (длинный src -> короткий dst) от того же номера
    const minLength = CALL_FILTER_CONFIG.outboundMinLength;
    const [cdrClientCallbacks] = await conn.execute(`
      SELECT 
        c.calldate, c.uniqueid, c.billsec, c.disposition,
        c.recordingfile, c.src, c.dst, c.dcontext,
        c.src as matched_number
      FROM asteriskcdrdb.cdr c
      WHERE c.disposition = 'ANSWERED'
        AND c.billsec >= 5
        AND c.src IS NOT NULL 
        AND c.src != ''
        AND c.dst IS NOT NULL 
        AND c.dst != ''
        AND LENGTH(TRIM(c.src)) > ?
        AND LENGTH(TRIM(c.dst)) <= ?
        AND (
          ${validCalls.map((vc, idx) => `
            (c.calldate >= ? AND c.calldate <= ? AND c.uniqueid != ? AND (
              c.src LIKE ? OR c.src LIKE ? OR 
              RIGHT(c.src, 10) = ? OR RIGHT(c.src, 9) = ? OR
              c.src = ?
            ))
          `).join(' OR ')}
        )
      ORDER BY c.calldate ASC
    `, [minLength, minLength, ...validCalls.flatMap(vc => [
      vc.callbackStart, vc.callbackEnd, vc.callId,
      `%${vc.clientNumberLast10}`, `%${vc.clientNumberLast9}`,
      vc.clientNumberLast10, vc.clientNumberLast9, vc.clientNumber
    ])]);

    // Создаем мапу найденных перезвонов от клиента
    const clientCallbackMap = new Map();
    cdrClientCallbacks.forEach(cb => {
      const matchedCall = validCalls.find(vc => {
        if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return false;
        if (cb.uniqueid === vc.callId) return false; // Исключаем оригинальный звонок
        
        const cbSrc = String(cb.src || '').trim();
        if (!cbSrc) return false;
        
        return cbSrc === vc.clientNumber ||
               cbSrc.slice(-10) === vc.clientNumberLast10 ||
               cbSrc.slice(-9) === vc.clientNumberLast9 ||
               vc.clientNumber.slice(-10) === cbSrc.slice(-10) ||
               vc.clientNumber.slice(-9) === cbSrc.slice(-9);
      });
      if (matchedCall && !clientCallbackMap.has(matchedCall.originalIndex)) {
        clientCallbackMap.set(matchedCall.originalIndex, cb);
      }
    });

    // Применяем результаты перезвонов от клиента
    clientCallbackMap.forEach((cb, idx) => {
      results[idx] = {
        type: 'client_callback',
        status: 'Перезвонил сам',
        callbackTime: cb.calldate,
        recordingFile: cb.recordingfile || validCalls.find(vc => vc.originalIndex === idx)?.call.recordingFile
      };
    });

    // 2. Batch-запрос для поиска перезвонов от агентов (исходящие звонки в CDR)
    const callsWithoutClientCallback = validCalls.filter(vc => !clientCallbackMap.has(vc.originalIndex));
    
    if (callsWithoutClientCallback.length > 0) {
      const minLength = CALL_FILTER_CONFIG.outboundMinLength;
      const [cdrAgentCallbacks] = await conn.execute(`
        SELECT 
          c.calldate, c.uniqueid, c.billsec, c.disposition,
          c.recordingfile, c.src, c.dst, c.dcontext,
          c.dst as matched_number
        FROM asteriskcdrdb.cdr c
        WHERE c.disposition = 'ANSWERED'
          AND c.billsec >= 5
          AND c.outbound_cnum IS NOT NULL 
          AND c.outbound_cnum != ''
          AND LENGTH(TRIM(c.outbound_cnum)) >= ?
          AND (c.lastapp IS NULL OR c.lastapp != 'Hangup')
          AND c.dst IS NOT NULL
          AND c.dst != ''
          AND LENGTH(TRIM(c.dst)) > ?
          AND (
            ${callsWithoutClientCallback.map((vc, idx) => `
              (c.calldate >= ? AND c.calldate <= ? AND (
                c.dst LIKE ? OR c.dst LIKE ? OR 
                RIGHT(c.dst, 10) = ? OR RIGHT(c.dst, 9) = ? OR
                c.dst = ?
              ))
            `).join(' OR ')}
          )
        ORDER BY c.calldate ASC
      `, [minLength, minLength, ...callsWithoutClientCallback.flatMap(vc => [
        vc.callbackStart, vc.callbackEnd,
        `%${vc.clientNumberLast10}`, `%${vc.clientNumberLast9}`,
        vc.clientNumberLast10, vc.clientNumberLast9, vc.clientNumber
      ])]);

      // Создаем мапу перезвонов от агентов
      const agentCallbackMap = new Map();
      cdrAgentCallbacks.forEach(cb => {
        const matchedCall = callsWithoutClientCallback.find(vc => {
          if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return false;
          
          const cbDst = String(cb.dst || '').trim();
          if (!cbDst) return false;
          
          return cbDst === vc.clientNumber ||
                 cbDst.slice(-10) === vc.clientNumberLast10 ||
                 cbDst.slice(-9) === vc.clientNumberLast9 ||
                 vc.clientNumber.slice(-10) === cbDst.slice(-10) ||
                 vc.clientNumber.slice(-9) === cbDst.slice(-9);
        });
        if (matchedCall && !agentCallbackMap.has(matchedCall.originalIndex)) {
          agentCallbackMap.set(matchedCall.originalIndex, cb);
        }
      });

      // Применяем результаты перезвонов от агентов
      agentCallbackMap.forEach((cb, idx) => {
        const vc = callsWithoutClientCallback.find(v => v.originalIndex === idx);
        if (vc && !clientCallbackMap.has(idx)) {
          results[idx] = {
            type: 'agent_callback',
            status: 'Перезвонили мы',
            callbackTime: cb.calldate,
            recordingFile: cb.recordingfile || vc.call.recordingFile
          };
        }
      });
    }

  } catch (error) {
    console.error('Ошибка при batch-проверке перезвонов для входящих звонков:', error);
  }

  return results;
}

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
  
  // ОПТИМИЗАЦИЯ: один проход по массиву вместо множественных filter/map
  let answeredCalls = 0;
  let abandonedCalls = 0;
  const waitTimes = [];
  const durations = [];
  const answeredWaitTimes = [];
  const allWaitTimes = [];
  let slaCalls = 0;
  
  const isAbandonedCall = (call) => {
    if (viewType === 'inbound') {
      return call.status === 'no_answer' || call.status === 'busy' || call.status === 'failed' ||
             (call.duration && parseInt(call.duration) <= 5);
    } else if (viewType === 'outbound' || viewType === 'outbound_queue') {
      // Для исходящих и исходящих очередей: пропущенные = не отвеченные, занято, неудачно
      return call.status === 'no_answer' || call.status === 'busy' || call.status === 'failed';
    } else {
      return call.status === 'abandoned';
    }
  };
  
  // Один проход для всех расчетов
  calls.forEach(call => {
    const isAbandoned = isAbandonedCall(call);
    
    if (viewType === 'inbound' || viewType === 'outbound' || viewType === 'outbound_queue') {
      if (call.status === 'answered') {
        answeredCalls++;
      } else if (isAbandoned) {
        abandonedCalls++;
      }
    } else {
      if (!isAbandoned) {
        answeredCalls++;
      } else {
        abandonedCalls++;
      }
    }
    
    // Собираем waitTimes
    const waitTime = call.waitTime || (helpers && helpers.calculateWaitTime ? helpers.calculateWaitTime(call) : null);
    if (waitTime !== '-' && waitTime !== null && waitTime !== undefined) {
      const parsed = parseInt(waitTime);
      if (!isNaN(parsed)) {
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
  
  // Считаем перезвоны ТОЛЬКО для пропущенных звонков (оптимизировано - один проход)
  let clientCallbacks = 0;
  let agentCallbacks = 0;
  calls.forEach(call => {
    if (isAbandonedCall(call)) {
      if (call.callbackStatus === 'Перезвонил сам') {
        clientCallbacks++;
      } else if (call.callbackStatus === 'Перезвонили мы') {
        agentCallbacks++;
      }
    }
  });
  
  calls.forEach(call => {
    if (call.startTime) {
      const hour = new Date(call.startTime).getHours();
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
  const avgWaitTimeAnswered = (viewType === 'queue' || viewType === 'outbound_queue') && answeredWaitTimes.length > 0
    ? Math.round(answeredWaitTimes.reduce((a, b) => a + b, 0) / answeredWaitTimes.length)
    : avgWaitTime;

  // Статистика перезвонов (уже посчитаны выше для callsByHour)
  // "Не обработан" = все пропущенные звонки минус те, у которых есть перезвоны
  // Используем abandonedCalls из статистики, чтобы логика была согласована
  const noCallbacks = Math.max(0, abandonedCalls - clientCallbacks - agentCallbacks);
  
  // Профессиональные метрики колл-центра
  // ASA (Average Speed of Answer) - среднее время ответа на звонок (уже посчитано выше)
  const asa = avgWaitTimeAnswered;
  
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

  // Передаем функции из app.js в email-service
  const callFunctions = {
    getQueueCalls,
    getInboundCalls,
    getOutboundCalls,
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
      const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
      
      // Получаем список всех очередей с активными email адресами
      const [queuesWithEmails] = await dbExecute(`
        SELECT DISTINCT queue_name
        FROM asteriskcdrdb.email_reports
        WHERE is_active = TRUE
      `);
      
      if (!queuesWithEmails || queuesWithEmails.length === 0) {
        console.log('📧 Нет очередей с активными email адресами для отправки отчетов');
        return;
      }
      
      let successCount = 0;
      let errorCount = 0;
      
      // Отправляем отчет для каждой очереди параллельно (оптимизация)
      const reportPromises = queuesWithEmails.map(async (queueRow) => {
        const queueName = queueRow.queue_name;
        try {
          console.log(`📧 Генерация отчета для очереди ${queueName}...`);
          const reportData = await generateQueueReport(pool, queueName, yesterday, callFunctions);
          const result = await sendQueueReport(reportData, queueName, pool);
          
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
    timezone: process.env.TZ || 'Europe/Moscow'
  });

  console.log(`📧 Ежедневные email отчеты настроены. Расписание: ${cronSchedule} (${process.env.TZ || 'Europe/Moscow'})`);
  console.log('📧 Отчеты будут отправляться для каждой очереди отдельно на указанные email адреса');
}

// Запуск сервера
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
    console.log(`Конфигурация фильтрации: минимальная длина номера для исходящих = ${CALL_FILTER_CONFIG.outboundMinLength}`);
    
    // Инициализируем отправку email отчетов
    initializeEmailReports();
  });
}).catch(err => {
  console.error('Ошибка при инициализации:', err);
});