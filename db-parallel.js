/**
 * Модуль параллельных запросов к БД для максимального использования CPU MySQL
 * Разбивает большие запросы на чанки и выполняет параллельно
 */

const { pool, execute: dbExecute, getConnection } = require('./db-optimizer');
const logger = require('./logger');

// Конфигурация параллелизма
const PARALLEL_CONFIG = {
  // Размер чанка для разбиения временных периодов (часы)
  TIME_CHUNK_HOURS: parseInt(process.env.DB_TIME_CHUNK_HOURS) || 4,
  // Максимальное количество параллельных запросов
  MAX_PARALLEL_QUERIES: parseInt(process.env.DB_MAX_PARALLEL) || 8,
  // Размер чанка для batch-запросов (количество элементов)
  BATCH_CHUNK_SIZE: parseInt(process.env.DB_BATCH_CHUNK_SIZE) || 50
};

/**
 * Разбить временной период на чанки для параллельной обработки
 * @param {string} startTime - Начало периода (YYYY-MM-DD HH:MM:SS)
 * @param {string} endTime - Конец периода (YYYY-MM-DD HH:MM:SS)
 * @param {number} chunkHours - Размер чанка в часах
 * @returns {Array} Массив чанков [{start, end}]
 */
function splitTimeIntoChunks(startTime, endTime, chunkHours = PARALLEL_CONFIG.TIME_CHUNK_HOURS) {
  const chunks = [];
  const start = new Date(startTime);
  const end = new Date(endTime);
  const chunkMs = chunkHours * 60 * 60 * 1000;
  
  let chunkStart = start;
  while (chunkStart < end) {
    let chunkEnd = new Date(chunkStart.getTime() + chunkMs);
    if (chunkEnd > end) {
      chunkEnd = end;
    }
    
    chunks.push({
      start: formatDateTime(chunkStart),
      end: formatDateTime(chunkEnd)
    });
    
    chunkStart = chunkEnd;
  }
  
  return chunks;
}

/**
 * Форматировать дату в MySQL формат
 */
function formatDateTime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Разбить массив на чанки
 * @param {Array} array - Исходный массив
 * @param {number} chunkSize - Размер чанка
 * @returns {Array} Массив чанков
 */
function chunkArray(array, chunkSize = PARALLEL_CONFIG.BATCH_CHUNK_SIZE) {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Выполнить несколько запросов параллельно с ограничением
 * @param {Array} queryFunctions - Массив функций, возвращающих Promise
 * @param {number} maxParallel - Максимальное количество параллельных запросов
 * @returns {Promise<Array>} Массив результатов
 */
async function executeParallel(queryFunctions, maxParallel = PARALLEL_CONFIG.MAX_PARALLEL_QUERIES) {
  const results = [];
  
  // Разбиваем на группы для параллельного выполнения
  for (let i = 0; i < queryFunctions.length; i += maxParallel) {
    const batch = queryFunctions.slice(i, i + maxParallel);
    const batchResults = await Promise.all(batch.map(fn => fn()));
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Получить звонки из очереди с параллельной обработкой по времени
 * Разбивает период на чанки и выполняет запросы параллельно
 * @param {string} queueName - Имя очереди
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @returns {Promise<Array>} Массив звонков
 */
async function getQueueCallsParallel(queueName, startTime, endTime) {
  const chunks = splitTimeIntoChunks(startTime, endTime);
  
  // Если период маленький (1 чанк), используем обычный запрос
  if (chunks.length <= 1) {
    return getQueueCallsSingle(queueName, startTime, endTime);
  }
  
  logger.info(`[DB Parallel] getQueueCalls: ${chunks.length} чанков для очереди ${queueName}`);
  
  // Создаем функции для параллельного выполнения
  const queryFunctions = chunks.map(chunk => async () => {
    return getQueueCallsSingle(queueName, chunk.start, chunk.end);
  });
  
  // Выполняем параллельно
  const results = await executeParallel(queryFunctions);
  
  // Объединяем результаты и удаляем дубликаты по callId
  const callsMap = new Map();
  results.flat().forEach(call => {
    if (!callsMap.has(call.callId)) {
      callsMap.set(call.callId, call);
    }
  });
  
  return Array.from(callsMap.values());
}

/**
 * Одиночный запрос для получения звонков из очереди
 */
async function getQueueCallsSingle(queueName, startTime, endTime) {
  const [rows] = await dbExecute(`
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

/**
 * Получить входящие звонки с параллельной обработкой
 */
async function getInboundCallsParallel(startTime, endTime, minLength = 4) {
  const chunks = splitTimeIntoChunks(startTime, endTime);
  
  if (chunks.length <= 1) {
    return getInboundCallsSingle(startTime, endTime, minLength);
  }
  
  logger.info(`[DB Parallel] getInboundCalls: ${chunks.length} чанков`);
  
  const queryFunctions = chunks.map(chunk => async () => {
    return getInboundCallsSingle(chunk.start, chunk.end, minLength);
  });
  
  const results = await executeParallel(queryFunctions);
  
  // Удаляем дубликаты по callId
  const callsMap = new Map();
  results.flat().forEach(call => {
    if (!callsMap.has(call.callId)) {
      callsMap.set(call.callId, call);
    }
  });
  
  return Array.from(callsMap.values());
}

/**
 * Одиночный запрос для входящих звонков
 */
async function getInboundCallsSingle(startTime, endTime, minLength) {
  const [rows] = await dbExecute(`
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
      isOutbound: false
    };
  });
}

/**
 * Получить исходящие звонки с параллельной обработкой
 */
async function getOutboundCallsParallel(startTime, endTime, minLength = 4) {
  const chunks = splitTimeIntoChunks(startTime, endTime);
  
  if (chunks.length <= 1) {
    return getOutboundCallsSingle(startTime, endTime, minLength);
  }
  
  logger.info(`[DB Parallel] getOutboundCalls: ${chunks.length} чанков`);
  
  const queryFunctions = chunks.map(chunk => async () => {
    return getOutboundCallsSingle(chunk.start, chunk.end, minLength);
  });
  
  const results = await executeParallel(queryFunctions);
  
  const callsMap = new Map();
  results.flat().forEach(call => {
    if (!callsMap.has(call.callId)) {
      callsMap.set(call.callId, call);
    }
  });
  
  return Array.from(callsMap.values());
}

/**
 * Одиночный запрос для исходящих звонков
 */
async function getOutboundCallsSingle(startTime, endTime, minLength) {
  const [rows] = await dbExecute(`
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
      isOutbound: true,
      outbound_cnum: row.outbound_cnum,
      cnum: row.cnum
    };
  });
}

/**
 * Проверка перезвонов с параллельной обработкой
 * Разбивает звонки на чанки и выполняет параллельно
 */
async function checkCallbacksParallel(calls, queueName, checkFunction) {
  if (!calls || calls.length === 0) {
    return [];
  }
  
  // Для небольшого количества звонков используем обычный подход
  if (calls.length <= PARALLEL_CONFIG.BATCH_CHUNK_SIZE) {
    return checkFunction(pool, calls, queueName);
  }
  
  logger.info(`[DB Parallel] checkCallbacks: разбиваем ${calls.length} звонков на чанки`);
  
  // Разбиваем на чанки
  const chunks = chunkArray(calls, PARALLEL_CONFIG.BATCH_CHUNK_SIZE);
  
  // Создаем функции для параллельного выполнения
  const queryFunctions = chunks.map(chunk => async () => {
    return checkFunction(pool, chunk, queueName);
  });
  
  // Выполняем параллельно
  const results = await executeParallel(queryFunctions);
  
  // Объединяем результаты
  return results.flat();
}

/**
 * Выполнить запрос с использованием UNION ALL вместо OR (быстрее для индексов)
 * @param {string} baseQuery - Базовый запрос с плейсхолдером {CONDITIONS}
 * @param {Array} conditions - Массив условий [{params: [...], condition: '...'}]
 * @returns {Promise<Array>} Результаты запроса
 */
async function executeWithUnion(baseQuery, conditions) {
  if (conditions.length === 0) {
    return [[]];
  }
  
  // Разбиваем на чанки
  const chunks = chunkArray(conditions, PARALLEL_CONFIG.BATCH_CHUNK_SIZE);
  
  const queryFunctions = chunks.map(chunk => async () => {
    // Создаем UNION ALL запрос (более эффективен, чем OR для индексов)
    const unionQueries = chunk.map((_, idx) => {
      return baseQuery.replace('{CONDITIONS}', chunk[idx].condition);
    });
    
    const fullQuery = unionQueries.join(' UNION ALL ');
    const params = chunk.flatMap(c => c.params);
    
    try {
      const [rows] = await dbExecute(fullQuery, params);
      return rows;
    } catch (error) {
      logger.error('[DB Parallel] UNION query error:', error.message);
      return [];
    }
  });
  
  const results = await executeParallel(queryFunctions);
  return [results.flat()];
}

module.exports = {
  PARALLEL_CONFIG,
  splitTimeIntoChunks,
  chunkArray,
  executeParallel,
  getQueueCallsParallel,
  getInboundCallsParallel,
  getOutboundCallsParallel,
  checkCallbacksParallel,
  executeWithUnion
};

