/**
 * @module db-calls
 * @description Базовые функции получения звонков из БД (fallback, когда USE_ULTRA_FAST_QUERIES = false)
 * 
 * @typedef {import('./types').QueueCall} QueueCall
 * @typedef {import('./types').Call} Call
 */

const { execute: dbExecute } = require('./db-optimizer');
const logger = require('./logger');

/**
 * Преобразование времени в строку формата YYYY-MM-DD HH:mm:ss
 * @param {Date|string|null} time - Время
 * @returns {string|null} Строковое представление времени
 */
function timeToString(time) {
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
}

/**
 * Маппинг disposition из CDR в статус звонка
 * @param {string} rawDisposition - Сырое значение disposition из БД
 * @returns {string} Статус: 'answered' | 'no_answer' | 'busy' | 'failed' | 'unknown'
 */
function mapDispositionToStatus(rawDisposition) {
  const disposition = (rawDisposition || '').trim().toUpperCase().replace(/\s+/g, '');
  switch (disposition) {
    case 'ANSWERED': return 'answered';
    case 'NOANSWER': return 'no_answer';
    case 'BUSY': return 'busy';
    case 'FAILED': return 'failed';
    default: return 'unknown';
  }
}

/**
 * Получить функцию выполнения запроса (conn.execute или dbExecute)
 * @param {Object|null} conn - Соединение с БД
 * @returns {Function} Функция выполнения запроса
 */
function getExecuteFn(conn) {
  return (conn && typeof conn.execute === 'function')
    ? conn.execute.bind(conn)
    : dbExecute;
}

/**
 * Маппинг строки CDR в объект звонка (для inbound/outbound)
 * @param {Object} row - Строка из CDR
 * @param {Object} options - Дополнительные параметры
 * @param {boolean} options.isOutbound - Является ли звонок исходящим
 * @returns {Call} Объект звонка
 */
function mapCdrRowToCall(row, { isOutbound = false } = {}) {
  const result = {
    callId: row.uniqueid,
    linkedid: row.linkedid,
    clientNumber: isOutbound ? (row.outbound_cnum || row.src) : row.src,
    destination: row.dst,
    startTime: timeToString(row.calldate),
    endTime: timeToString(row.calldate),
    status: mapDispositionToStatus(row.disposition),
    duration: row.billsec || 0,
    waitTime: null,
    recordingFile: row.recordingfile,
    dcontext: row.dcontext,
    channel: row.channel,
    isOutbound
  };

  if (isOutbound) {
    result.outbound_cnum = row.outbound_cnum;
    result.cnum = row.cnum;
  }

  return result;
}

/**
 * Получить звонки очереди за период (fallback)
 * @param {Object|null} conn - Соединение с БД (null = используем dbExecute)
 * @param {string} queueName - Название очереди
 * @param {Date|string} startTime - Начало периода
 * @param {Date|string} endTime - Конец периода
 * @returns {Promise<QueueCall[]>} Массив звонков
 */
async function getQueueCalls(conn, queueName, startTime, endTime) {
  const executeFn = getExecuteFn(conn);

  // Если conn null - возвращаем сырые строки (совместимость с ultra-fast flow)
  if (!conn || typeof conn.execute !== 'function') {
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

  const [rows] = await executeFn(`
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

/**
 * Получить входящие звонки из CDR за период
 * @param {Object} conn - Соединение с БД
 * @param {Date|string} startTime - Начало периода
 * @param {Date|string} endTime - Конец периода
 * @param {number} minLength - Минимальная длина номера для фильтрации
 * @returns {Promise<Call[]>} Массив звонков
 */
async function getInboundCalls(conn, startTime, endTime, minLength = 4) {
  const executeFn = getExecuteFn(conn);
  const [rows] = await executeFn(`
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

  return rows.map(row => mapCdrRowToCall(row, { isOutbound: false }));
}

/**
 * Получить исходящие звонки из CDR за период
 * @param {Object|null} conn - Соединение с БД
 * @param {Date|string} startTime - Начало периода
 * @param {Date|string} endTime - Конец периода
 * @param {number} minLength - Минимальная длина номера для фильтрации
 * @returns {Promise<Call[]>} Массив звонков
 */
async function getOutboundCalls(conn, startTime, endTime, minLength = 4) {
  const executeFn = getExecuteFn(conn);
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

  return rows.map(row => mapCdrRowToCall(row, { isOutbound: true }));
}

/**
 * Получить список внутренних номеров (агентов) из очереди
 * @param {Object|null} conn - Соединение с БД
 * @param {string} queueName - Название очереди
 * @returns {Promise<string[]>} Массив номеров агентов
 */
async function getQueueAgents(conn, queueName) {
  const executeFn = getExecuteFn(conn);

  const [rows] = await executeFn(`
    SELECT DISTINCT data as member
    FROM asterisk.queues_details
    WHERE id = ? AND keyword = 'member'
  `, [queueName]);

  const agents = rows.map(row => {
    const member = String(row.member || '').trim();
    const match = member.match(/Local\/(\d+)@/);
    return match ? match[1] : null;
  }).filter(agent => agent && agent.length >= 3 && agent.length <= 5);

  return [...new Set(agents)];
}

/**
 * Получить исходящие звонки от внутренних номеров из очереди
 * @param {Object|null} conn - Соединение с БД
 * @param {string} queueName - Название очереди
 * @param {Date|string} startTime - Начало периода
 * @param {Date|string} endTime - Конец периода
 * @param {number} minLength - Минимальная длина номера для фильтрации
 * @returns {Promise<Call[]>} Массив звонков
 */
async function getOutboundQueueCalls(conn, queueName, startTime, endTime, minLength = 4) {
  const agents = await getQueueAgents(conn, queueName);

  if (!agents || agents.length === 0) {
    logger.info(`[getOutboundQueueCalls] Не найдено агентов в очереди ${queueName} за период ${startTime} - ${endTime}`);
    return [];
  }

  logger.info(`[getOutboundQueueCalls] Найдено ${agents.length} агентов в очереди ${queueName}: ${agents.slice(0, 5).join(', ')}${agents.length > 5 ? '...' : ''}`);

  const executeFn = getExecuteFn(conn);
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

  return rows.map(row => mapCdrRowToCall(row, { isOutbound: true }));
}

module.exports = {
  timeToString,
  mapDispositionToStatus,
  getQueueCalls,
  getInboundCalls,
  getOutboundCalls,
  getQueueAgents,
  getOutboundQueueCalls
};
