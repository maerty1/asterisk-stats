require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const { format } = require('date-fns');
const path = require('path');
const fs = require('fs');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;

// Конфигурация базы данных
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'freepbxuser',
  password: process.env.DB_PASS || 'XCbMZ1TmmqGS',
  database: process.env.DB_NAME || 'asterisk',
  connectionLimit: 5
};

let availableQueues = [];

// Middleware
app.use(compression()); // Сжатие gzip
app.set('view engine', 'ejs');
app.set('view cache', false); // Отключаем кэширование шаблонов
app.use(express.urlencoded({ extended: true }));

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
    
    const datePart = recordingFile.split('-')[3];
    if (!datePart || datePart.length !== 8) return null;
    
    const year = datePart.substring(0, 4);
    const month = datePart.substring(4, 6);
    const day = datePart.substring(6, 8);
    
    return `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
  }
};

// Инициализация приложения
async function initializeApp() {
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    const [queues] = await connection.execute(`
      SELECT DISTINCT queuename 
      FROM asteriskcdrdb.queuelog 
      WHERE queuename IS NOT NULL AND queuename != 'NONE'
      ORDER BY queuename
    `);
    availableQueues = queues.map(q => q.queuename);
    await connection.end();
    console.log('Загружено очередей:', availableQueues.length);
  } catch (err) {
    console.error('Ошибка при загрузке очередей:', err);
  }
}

// API для проверки статуса системы (добавлен перед основными маршрутами)
app.get('/api/status', async (req, res) => {
  try {
    const connection = await mysql.createConnection(DB_CONFIG);
    await connection.execute('SELECT 1 as test');
    await connection.end();
    
    res.json({
      status: 'online',
      database: 'connected',
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
app.get('/', (req, res) => {
  const today = format(new Date(), 'yyyy-MM-dd');
  res.render('index', { 
    title: 'Анализатор очередей Asterisk',
    queues: availableQueues,
    results: null,
    startDate: today,
    endDate: today,
    selectedQueue: '',
    helpers
  });
});

app.post('/report', async (req, res) => {
  try {
    const { queue_name, start_date, end_date } = req.body;
    const startTime = `${start_date} 00:00:00`;
    const endTime = `${end_date} 23:59:59`;
    
    const connection = await mysql.createConnection(DB_CONFIG);
    let calls = await getQueueCalls(connection, queue_name, startTime, endTime);
    
    // Проверяем перезвоны для каждого пропущенного звонка
    let callbackCheckCount = 0;
    let abandonedCount = 0;
    for (let i = 0; i < calls.length; i++) {
      // Определяем, является ли звонок пропущенным
      const isAbandoned = calls[i].status === 'abandoned' || 
                          (calls[i].duration && parseInt(calls[i].duration) <= 5) ||
                          (!calls[i].connectTime && calls[i].endTime && calls[i].status !== 'completed_by_agent' && calls[i].status !== 'completed_by_caller');
      
      if (isAbandoned) {
        abandonedCount++;
        const callback = await checkCallbacks(connection, calls[i]);
        if (callback) {
          calls[i].callback = callback;
          calls[i].callbackStatus = callback.status;
          callbackCheckCount++;
          // Обновляем recordingFile если найден перезвон с записью
          if (callback.recordingFile) {
            calls[i].recordingFile = callback.recordingFile;
          }
        } else {
          // Если callback вернул null (не должно происходить, но на всякий случай)
          calls[i].callbackStatus = 'Не обработан';
        }
      }
    }
    console.log(`Проверено перезвонов: ${callbackCheckCount} из ${abandonedCount} пропущенных звонков (всего звонков: ${calls.length})`);
    
    const stats = calculateStats(calls);
    await connection.end();

    res.render('index', { 
      title: `Отчет по очереди ${queue_name}`,
      queues: availableQueues,
      selectedQueue: queue_name,
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
// Используем регулярное выражение для точного перехвата имен файлов
app.get(/^\/recordings\/(in-\d+-\d+-\d{8}-\d{6}-\d+\.\d+\.mp3)$/, (req, res) => {
  const filename = req.params[0]; // Получаем из регулярного выражения
  console.log('Fallback route hit with filename:', filename, 'full URL:', req.originalUrl);

  // Проверяем, что это имя файла записи
  const isValidFilename = filename.match(/^in-\d+-\d+-\d{8}-\d{6}-\d+\.\d+\.mp3$/);
  console.log('Filename matches pattern:', isValidFilename);

  if (isValidFilename) {
    // Извлекаем дату из имени файла
    const datePart = filename.split('-')[3];
    console.log('Date part:', datePart);
    if (datePart && datePart.length === 8) {
      const year = datePart.substring(0, 4);
      const month = datePart.substring(4, 6);
      const day = datePart.substring(6, 8);
      // Перенаправляем на правильный формат URL
      const correctUrl = `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(filename)}`;
      console.log('Redirecting old format URL to:', correctUrl);
      return res.redirect(301, correctUrl);
    }
  }

  console.log('Filename does not match pattern or invalid date');
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
  if (!filename && year && year.match(/^in-\d+-\d+-\d{8}-\d{6}-\d+\.\d+\.mp3$/) && !month && !day) {
    filename = year;
    // Извлекаем дату из имени файла
    const datePart = filename.split('-')[3];
    if (datePart && datePart.length === 8) {
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
  if (!filename.match(/^in-\d+-\d+-\d{8}-\d{6}-\d+\.\d+\.mp3$/)) {
    console.log('Filename validation failed for:', filename);
    return res.status(400).render('error', {
      message: 'Неверный формат имени файла записи',
      error: { message: `Файл ${filename} имеет неверный формат` },
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

// Функция проверки перезвонов (исправленная версия)
async function checkCallbacks(conn, call) {
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
  
  console.log(`[checkCallbacks] Проверка перезвонов для звонка ${call.callId}:`);
  console.log(`  Номер: ${clientNumberStr} (последние 10: ${clientNumberLast10}, последние 9: ${clientNumberLast9})`);
  console.log(`  Период поиска: ${callbackStartStr} - ${callbackEndStr}`);

  try {
    // Проверка 1: Перезвонил сам (входящий звонок от клиента)
    // Ищем ВСЕ успешно отвеченные звонки от этого номера в течение 2 часов
    // Не ограничиваемся очередью, так как перезвон может быть не через очередь
    const [clientCallbackRows] = await conn.execute(`
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
      ORDER BY c.calldate ASC
      LIMIT 1
    `, [callbackStartStr, callbackEndStr, `%${clientNumberLast10}`, `%${clientNumberLast9}`, clientNumberLast10, clientNumberLast9, clientNumberStr]);

    if (clientCallbackRows && clientCallbackRows.length > 0) {
      const callback = clientCallbackRows[0];
      console.log(`[checkCallbacks] ✅ Найден перезвон от клиента для ${call.callId}:`);
      console.log(`  callback.uniqueid: ${callback.uniqueid}`);
      console.log(`  callback.src: ${callback.src}`);
      console.log(`  callback.calldate: ${callback.calldate}`);
      console.log(`  callback.billsec: ${callback.billsec}`);
      console.log(`  callback.disposition: ${callback.disposition}`);
      
      if (callback.disposition === 'ANSWERED' && callback.billsec >= 5) {
        return {
          type: 'client_callback',
          status: 'Перезвонил сам',
          callbackTime: callback.calldate,
          recordingFile: callback.recordingfile || call.recordingFile
        };
      }
    } else {
      console.log(`[checkCallbacks] ❌ Перезвон от клиента не найден для ${call.callId}`);
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
      console.log(`[checkCallbacks] ✅ Найден перезвон от агента для ${call.callId}:`);
      console.log(`  callback.uniqueid: ${callback.uniqueid}`);
      console.log(`  callback.dst: ${callback.dst}`);
      console.log(`  callback.calldate: ${callback.calldate}`);
      console.log(`  callback.billsec: ${callback.billsec}`);
      
      if (callback.disposition === 'ANSWERED' && callback.billsec >= 5) {
        return {
          type: 'agent_callback',
          status: 'Перезвонили мы',
          callbackTime: callback.calldate,
          recordingFile: callback.recordingfile || call.recordingFile
        };
      }
    } else {
      console.log(`[checkCallbacks] ❌ Перезвон от агента не найден для ${call.callId}`);
    }
    
    // Не обработан - не нашли ни перезвон от клиента, ни от агента
    console.log(`[checkCallbacks] ⏸️ Не обработан для ${call.callId} - перезвонов не найдено`);
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

// Функции расчета статистики
function calculateStats(calls) {
  const totalCalls = calls.length;
  const answeredCalls = calls.filter(c => c.status !== 'abandoned').length;
  const abandonedCalls = totalCalls - answeredCalls;
  
  const waitTimes = calls.map(call => 
    call.waitTime || helpers.calculateWaitTime(call)).filter(t => t !== '-');
  const avgWaitTime = waitTimes.length > 0 
    ? Math.round(waitTimes.reduce((a, b) => a + parseInt(b), 0) / waitTimes.length)
    : 0;
  
  const durations = calls.map(call => call.duration).filter(d => d);
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + parseInt(b), 0) / durations.length)
    : 0;

  // SLA: звонки, принятые в первые 20 секунд
  const slaThreshold = 20; // секунд
  const slaCalls = calls.filter(call => {
    if (call.status === 'abandoned') return false;
    const waitTime = call.waitTime || helpers.calculateWaitTime(call);
    return waitTime !== '-' && parseInt(waitTime) <= slaThreshold;
  }).length;
  const slaRate = totalCalls > 0 ? Math.round(slaCalls / totalCalls * 100) : 0;

  // Среднее время в очереди для всех звонков
  const allWaitTimes = calls.map(call => {
    const wt = call.waitTime || helpers.calculateWaitTime(call);
    return wt !== '-' ? parseInt(wt) : null;
  }).filter(t => t !== null);
  const avgQueueTime = allWaitTimes.length > 0
    ? Math.round(allWaitTimes.reduce((a, b) => a + b, 0) / allWaitTimes.length)
    : 0;

  // Пиковый час и разбивка по часам
  const callsByHour = {};
  for (let i = 0; i < 24; i++) {
    callsByHour[i] = { total: 0, answered: 0, abandoned: 0 };
  }
  
  calls.forEach(call => {
    if (call.startTime) {
      const hour = new Date(call.startTime).getHours();
      callsByHour[hour].total++;
      if (call.status === 'abandoned') {
        callsByHour[hour].abandoned++;
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

  // Среднее ожидание для отвеченных звонков
  const answeredWaitTimes = calls
    .filter(c => c.status !== 'abandoned')
    .map(call => {
      const wt = call.waitTime || helpers.calculateWaitTime(call);
      if (wt === '-' || wt === null || wt === undefined) return null;
      const parsed = parseInt(wt);
      return isNaN(parsed) ? null : parsed;
    })
    .filter(t => t !== null && !isNaN(t));
  const avgWaitTimeAnswered = answeredWaitTimes.length > 0
    ? Math.round(answeredWaitTimes.reduce((a, b) => a + b, 0) / answeredWaitTimes.length)
    : 0;

  // Статистика перезвонов
  const clientCallbacks = calls.filter(c => c.callbackStatus === 'Перезвонил сам').length;
  const agentCallbacks = calls.filter(c => c.callbackStatus === 'Перезвонили мы').length;
  
  // "Не обработан" = все пропущенные звонки минус те, у которых есть перезвоны
  // Используем abandonedCalls из статистики, чтобы логика была согласована
  const noCallbacks = Math.max(0, abandonedCalls - clientCallbacks - agentCallbacks);
  
  // Отладочная информация
  const abandonedCount = calls.filter(c => c.status === 'abandoned').length;
  const withCallbackStatus = calls.filter(c => c.callbackStatus).length;
  console.log('Статистика перезвонов:', {
    clientCallbacks,
    agentCallbacks,
    noCallbacks,
    abandonedCalls,
    calculation: `${abandonedCalls} - ${clientCallbacks} - ${agentCallbacks} = ${noCallbacks}`,
    totalAbandoned: abandonedCount,
    withCallbackStatus,
    totalCalls: calls.length,
    check: `clientCallbacks(${clientCallbacks}) + agentCallbacks(${agentCallbacks}) + noCallbacks(${noCallbacks}) = ${clientCallbacks + agentCallbacks + noCallbacks}, должно быть ${abandonedCalls}`
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
    noCallbacks
  };
}

// Запуск сервера
initializeApp().then(() => {
  app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Ошибка при инициализации:', err);
});