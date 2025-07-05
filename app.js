require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const { format } = require('date-fns');
const path = require('path');
const fs = require('fs');

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
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

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
  getRecordingLink: (recordingFile) => {
    if (!recordingFile) return null;
    
    const datePart = recordingFile.split('-')[3];
    if (!datePart || datePart.length !== 8) return null;
    
    const year = datePart.substring(0, 4);
    const month = datePart.substring(4, 6);
    const day = datePart.substring(6, 8);
    
    return `/recordings/${year}/${month}/${day}/${encodeURIComponent(recordingFile)}`;
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
    const calls = await getQueueCalls(connection, queue_name, startTime, endTime);
    const stats = calculateStats(calls);
    await connection.end();

    res.render('index', { 
      title: `Отчет по очереди ${queue_name}`,
      queues: availableQueues,
      selectedQueue: queue_name,
      results: { 
        calls: calls.slice(0, 200),
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

// Маршрут для доступа к записям
app.get('/recordings/:year/:month/:day/:filename', (req, res) => {
  const { year, month, day, filename } = req.params;
  const decodedFilename = decodeURIComponent(filename);
  
  if (!decodedFilename.match(/^in-\d{10}-\d{10}-\d{8}-\d{6}-\d+\.\d+\.mp3$/)) {
    return res.status(400).render('error', {
      message: 'Неверный формат имени файла записи',
      error: { message: `Файл ${decodedFilename} имеет неверный формат` },
      helpers,
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }

  const filePath = path.join(
    process.env.RECORDINGS_PATH || '/var/spool/asterisk/monitor',
    year, month, day, decodedFilename
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).render('error', {
      message: 'Запись не найдена',
      error: { message: `Файл ${decodedFilename} не найден в ${year}/${month}/${day}` },
      helpers,
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }

  res.sendFile(filePath, {
    headers: {
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': `inline; filename="${decodedFilename}"`
    }
  });
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
        status: 'abandoned',
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
        break;
    }
  });

  return Object.values(calls);
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

  return {
    totalCalls,
    answeredCalls,
    abandonedCalls,
    answerRate: totalCalls > 0 ? Math.round(answeredCalls/totalCalls*100) : 0,
    avgWaitTime,
    avgDuration
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