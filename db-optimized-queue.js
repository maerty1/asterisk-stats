/**
 * Оптимизированные запросы для получения звонков
 * Стратегия: 2 запроса + Map в памяти (самый быстрый метод)
 * 
 * Логика совместима с PHP проектом ruk-stats
 */

const { execute: dbExecute, getConnection } = require('./db-optimizer');
const logger = require('./logger');

// Константа для разбиения запросов на батчи (избежание ошибки "too many placeholders")
const BATCH_SIZE = 1000;

// =============================================================================
// ОБЩИЕ ФУНКЦИИ
// =============================================================================

/**
 * Преобразование времени в строку (гарантирует строковый формат)
 * @param {Date|string|any} time - Время (Date объект или строка)
 * @returns {string|null} Строка формата "YYYY-MM-DD HH:MM:SS" или null
 */
function timeToString(time) {
  if (!time) return null;
  if (typeof time === 'string') {
    // Если это строка, проверяем что она не в формате ISO с Z (UTC)
    // Если есть Z в конце - это UTC время, нужно извлечь как есть (без преобразования)
    if (time.endsWith('Z') || time.includes('T') && time.includes('Z')) {
      // ISO формат UTC: "2025-12-29T20:13:47.000Z" -> "2025-12-29 20:13:47"
      const match = time.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
      }
    }
    return time;
  }
  if (time instanceof Date) {
    // Если это Date объект - НЕ используем getHours() так как он вернет локальное время
    // Вместо этого используем toISOString и извлекаем время
    // Но если MySQL вернул строку, она не должна быть Date объектом
    // Это fallback для случаев когда всё-таки пришел Date
    const iso = time.toISOString();
    const match = iso.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      // Извлекаем UTC время из ISO строки (без преобразования)
      return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}:${match[6]}`;
    }
    // Fallback - используем локальное время (не идеально, но лучше чем ничего)
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
 * Создание Map из массива для быстрого поиска
 * @param {Array} rows - Массив записей
 * @param {string} keyField - Поле для ключа
 * @param {string} valueField - Поле для значения
 * @returns {Map}
 */
function createMap(rows, keyField, valueField) {
  const map = new Map();
  rows.forEach(r => {
    if (!map.has(r[keyField])) {
      map.set(r[keyField], r[valueField]);
    }
  });
  return map;
}

/**
 * Нормализация disposition в статус
 * @param {string} disposition - Значение disposition из CDR
 * @returns {string} Нормализованный статус
 */
function normalizeDisposition(disposition) {
  const d = (disposition || '').trim().toUpperCase().replace(/\s+/g, '');
  switch (d) {
    case 'ANSWERED': return 'answered';
    case 'NOANSWER': return 'no_answer';
    case 'BUSY': return 'busy';
    case 'FAILED': return 'failed';
    default: return 'unknown';
  }
}

/**
 * Определение статуса на основе EVENT из queuelog (логика PHP)
 * @param {string} event - EVENT из queuelog
 * @param {string} disposition - Disposition из CDR
 * @param {number} duration - Длительность разговора
 * @returns {string} Статус звонка
 */
function getStatusFromEvent(event, disposition, duration) {
  const e = (event || '').trim().toUpperCase();
  const d = (disposition || '').trim().toUpperCase().replace(/\s+/g, '');
  
  // Логика PHP: пропущенный = EVENT не COMPLETECALLER/COMPLETEAGENT ИЛИ dur <= 5
  const isAbandoned = (e !== 'COMPLETECALLER' && e !== 'COMPLETEAGENT') || 
                     (duration !== null && parseInt(duration) <= 5);
  
  if (isAbandoned) {
    if (d === 'NO ANSWER' || d === 'NOANSWER') return 'no_answer';
    if (d === 'BUSY') return 'busy';
    if (d === 'FAILED') return 'failed';
    return 'abandoned';
  }
  
  return 'answered';
}

// =============================================================================
// ОЧЕРЕДИ (QUEUE)
// =============================================================================

/**
 * UltraFast: Получение звонков очереди
 * Стратегия: 2 запроса + Map
 * 1. Получаем события из queuelog
 * 2. Получаем recordingfile из cdr для linkedid
 * 3. Объединяем через Map
 * 
 * @param {string} queueName - Название очереди
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @returns {Array} Массив звонков
 */
async function getQueueCallsUltraFast(queueName, startTime, endTime) {
  const startTotal = Date.now();
  
  // Шаг 1: Получаем все события очереди (индекс по queue+time)
  const start1 = Date.now();
  const [queueRows] = await dbExecute(`
    SELECT 
      q.time, q.event, q.callid, q.queuename, q.agent, 
      q.data1, q.data2, q.data3, q.data4, q.data5
    FROM asteriskcdrdb.queuelog q
    WHERE q.queuename = ? 
      AND q.time BETWEEN ? AND ?
    ORDER BY q.time
  `, [queueName, startTime, endTime]);
  const time1 = Date.now() - start1;
  
  if (queueRows.length === 0) {
    return [];
  }
  
  // Шаг 2: Собираем уникальные callid
  const callIds = [...new Set(queueRows.map(r => r.callid))];
  
  // Получаем minLength из настроек (для фильтрации входящих звонков)
  const minLength = parseInt(process.env.OUTBOUND_MIN_LENGTH || '4', 10);
  
  // Шаг 3: Получаем данные из CDR (recordingfile + src/dst для фильтрации) - разбиваем на батчи
  const start2 = Date.now();
  let cdrRows = [];
  
  for (let i = 0; i < callIds.length; i += BATCH_SIZE) {
    const batch = callIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const [batchRows] = await dbExecute(`
      SELECT 
        linkedid, 
        uniqueid,
        recordingfile,
        src,
        dst,
        CASE 
          WHEN recordingfile LIKE ? THEN 1
          WHEN recordingfile LIKE 'q-%' THEN 2
          ELSE 3
        END as priority
      FROM asteriskcdrdb.cdr
      WHERE linkedid IN (${placeholders})
        AND disposition = 'ANSWERED'
        AND recordingfile IS NOT NULL
      ORDER BY linkedid, priority, recordingfile
    `, [`q-${queueName}-%`, ...batch]);
    cdrRows.push(...batchRows);
  }
  const time2 = Date.now() - start2;
  
  // Шаг 3b: Получаем src/dst для всех звонков (для фильтрации входящих)
  // Проверяем по linkedid, так как в queuelog callid обычно равен linkedid
  // Разбиваем на батчи для избежания ошибки "too many placeholders"
  let cdrDataRows = [];
  
  for (let i = 0; i < callIds.length; i += BATCH_SIZE) {
    const batch = callIds.slice(i, i + BATCH_SIZE);
    const batchPlaceholders = batch.map(() => '?').join(',');
    const [batchRows] = await dbExecute(`
      SELECT 
        uniqueid,
        linkedid,
        src,
        dst
      FROM asteriskcdrdb.cdr
      WHERE (uniqueid IN (${batchPlaceholders}) OR linkedid IN (${batchPlaceholders}))
        AND src IS NOT NULL 
        AND src != ''
        AND dst IS NOT NULL 
        AND dst != ''
      GROUP BY linkedid, uniqueid
    `, [...batch, ...batch]);
    cdrDataRows.push(...batchRows);
  }
  
  // Создаем Map для фильтрации по длине номера (по linkedid и uniqueid)
  const cdrDataMap = new Map();
  const cdrDataMapByLinkedId = new Map();
  cdrDataRows.forEach(row => {
    const data = {
      src: row.src,
      dst: row.dst,
      linkedid: row.linkedid
    };
    cdrDataMap.set(row.uniqueid, data);
    cdrDataMapByLinkedId.set(row.linkedid, data);
  });
  
  // Шаг 4: Фильтруем callIds - оставляем только входящие звонки (от длинного на короткий)
  const validCallIds = callIds.filter(callid => {
    // Проверяем по uniqueid и linkedid (callid может быть и тем, и другим)
    const cdrData = cdrDataMap.get(callid) || cdrDataMapByLinkedId.get(callid);
    
    // Если нет данных в CDR - исключаем (это не входящий звонок из внешней сети)
    if (!cdrData || !cdrData.src || !cdrData.dst) {
      return false;
    }
    
    const srcLength = cdrData.src.toString().length;
    const dstLength = cdrData.dst.toString().length;
    
    // Входящий звонок: src (от клиента) длинный (> minLength), dst (к очереди) короткий (<= minLength)
    // Пример: src = "89001234567" (11 цифр), dst = "1049" (4 цифры) - это входящий
    // Пример: src = "1033" (4 цифры), dst = "1049" (4 цифры) - это внутренний, исключаем
    return srcLength > minLength && dstLength <= minLength;
  });
  
  // Шаг 5: Создаем Map для recordingfile (только для валидных звонков)
  const validLinkedIds = new Set(validCallIds.map(callid => {
    const cdrData = cdrDataMap.get(callid);
    return cdrData ? cdrData.linkedid : callid;
  }));
  const recordingMap = createMap(
    cdrRows.filter(row => validLinkedIds.has(row.linkedid)), 
    'linkedid', 
    'recordingfile'
  );
  
  // Шаг 6: Обрабатываем в памяти (только валидные звонки)
  const start3 = Date.now();
  const validCallIdsSet = new Set(validCallIds);
  const calls = {};
  
  queueRows.forEach(row => {
    // Пропускаем звонки, которые не прошли фильтрацию по длине номера
    if (!validCallIdsSet.has(row.callid)) {
      return;
    }
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
        recordingFile: recordingMap.get(row.callid) || null,
        linkedid: row.callid,
        queuename: row.queuename
      };
    }
    
    calls[row.callid].events.push(row);
    
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
      case 'EXITWITHTIMEOUT':
        calls[row.callid].endTime = timeToString(row.time);
        calls[row.callid].waitTime = row.data3;
        calls[row.callid].status = 'abandoned';
        break;
    }
  });
  
  const result = Object.values(calls);
  const time3 = Date.now() - start3;
  const totalTime = Date.now() - startTotal;
  
  if (process.env.DEBUG_DB === 'true') {
    logger.info(`[UltraFast Queue] queuelog: ${time1}ms, cdr: ${time2}ms, обработка: ${time3}ms, всего: ${totalTime}ms, звонков: ${result.length}`);
  }
  
  return result;
}

/**
 * Subquery: Получение звонков очереди через подзапрос
 */
async function getQueueCallsSubquery(queueName, startTime, endTime) {
  const [rows] = await dbExecute(`
    SELECT 
      q.time, q.event, q.callid, q.queuename, q.agent, 
      q.data1, q.data2, q.data3, q.data4, q.data5,
      (SELECT c.recordingfile 
       FROM asteriskcdrdb.cdr c 
       WHERE c.linkedid = q.callid 
         AND c.disposition = 'ANSWERED' 
       LIMIT 1) as recordingfile,
      q.callid as linkedid
    FROM asteriskcdrdb.queuelog q
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
        linkedid: row.linkedid,
        queuename: row.queuename
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
      case 'EXITWITHTIMEOUT':
        calls[row.callid].endTime = timeToString(row.time);
        calls[row.callid].waitTime = row.data3;
        calls[row.callid].status = 'abandoned';
        break;
    }
  });

  return Object.values(calls);
}

// =============================================================================
// ВХОДЯЩИЕ ЗВОНКИ (INBOUND) - БЕЗ ФИЛЬТРАЦИИ ПО ОЧЕРЕДИ
// =============================================================================

/**
 * UltraFast: Получение всех входящих звонков (без фильтрации по очереди)
 * Используется когда очередь не выбрана
 * Стратегия: 2 запроса + Map
 * 
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @param {number} minLength - Минимальная длина номера
 * @returns {Array} Массив входящих звонков
 */
async function getInboundCallsUltraFast(startTime, endTime, minLength = 4) {
  const startTotal = Date.now();
  
  // Шаг 1: Получаем базовые данные входящих (без recordingfile)
  const start1 = Date.now();
  const [rows] = await dbExecute(`
    SELECT 
      c.calldate, c.uniqueid, c.linkedid, c.src, c.dst, 
      c.disposition, c.billsec, c.duration,
      c.dcontext, c.channel, c.lastapp, c.lastdata
    FROM asteriskcdrdb.cdr c
    WHERE c.calldate BETWEEN ? AND ?
      AND c.src IS NOT NULL 
      AND c.src != ''
      AND c.dst IS NOT NULL 
      AND c.dst != ''
      AND CHAR_LENGTH(c.src) > ?
      AND CHAR_LENGTH(c.dst) <= ?
    ORDER BY c.calldate DESC
  `, [startTime, endTime, minLength, minLength]);
  const time1 = Date.now() - start1;
  
  if (rows.length === 0) {
    return [];
  }
  
  // Шаг 2: Собираем уникальные linkedid
  const linkedIds = [...new Set(rows.map(r => r.linkedid))];
  
  // Шаг 3: Получаем recordingfile отдельно (разбиваем на батчи для избежания ошибки "too many placeholders")
  const start2 = Date.now();
  let recordingRows = [];
  
  // Разбиваем linkedIds на батчи
  for (let i = 0; i < linkedIds.length; i += BATCH_SIZE) {
    const batch = linkedIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const [batchRows] = await dbExecute(`
      SELECT linkedid, recordingfile
      FROM asteriskcdrdb.cdr
      WHERE linkedid IN (${placeholders})
        AND disposition = 'ANSWERED'
        AND recordingfile IS NOT NULL
        AND recordingfile != ''
      ORDER BY linkedid, calldate DESC
    `, batch);
    recordingRows.push(...batchRows);
  }
  const time2 = Date.now() - start2;
  
  // Шаг 4: Создаем Map
  const recordingMap = createMap(recordingRows, 'linkedid', 'recordingfile');
  
  // Шаг 5: Обрабатываем в памяти
  const start3 = Date.now();
  const calls = rows.map(row => ({
    callId: row.uniqueid,
    linkedid: row.linkedid,
    clientNumber: row.src,
    destination: row.dst,
    startTime: timeToString(row.calldate),
    endTime: timeToString(row.calldate),
    status: normalizeDisposition(row.disposition),
    duration: row.billsec || 0,
    waitTime: null,
    recordingFile: recordingMap.get(row.linkedid) || null,
    dcontext: row.dcontext,
    channel: row.channel,
    isOutbound: false
  }));
  const time3 = Date.now() - start3;
  
  const totalTime = Date.now() - startTotal;
  
  if (process.env.DEBUG_DB === 'true') {
    logger.info(`[UltraFast Inbound All] cdr: ${time1}ms, recordings: ${time2}ms, обработка: ${time3}ms, всего: ${totalTime}ms, звонков: ${calls.length}`);
  }
  
  return calls;
}

// =============================================================================
// ВХОДЯЩИЕ ЗВОНКИ (INBOUND) - С ФИЛЬТРАЦИЕЙ ПО ОЧЕРЕДИ (КАК В PHP)
// =============================================================================

/**
 * UltraFast: Получение входящих звонков с фильтрацией по очереди
 * Логика совместима с PHP проектом ruk-stats
 * Стратегия: 2 запроса + Map
 * 
 * PHP SQL:
 * SELECT ... FROM queuelog, cdr 
 * WHERE (channel LIKE 'PJSIP%' OR channel LIKE 'SIP%')
 *   AND queuelog.time >= start AND queuelog.time <= end
 *   AND queuelog.callid = cdr.uniqueid
 *   AND ((EVENT IN ('COMPLETECALLER','COMPLETEAGENT') AND recordingfile IS NOT NULL AND disposition='ANSWERED')
 *     OR (EVENT IN ('ABANDON','EXITWITHTIMEOUT') AND disposition='NO ANSWER'))
 *   AND queuename IN (queue)
 *   AND LENGTH(src) >= 5 AND LENGTH(did) >= 4
 * GROUP BY linkedid
 * 
 * @param {string|Array} queueNames - Очередь или массив очередей
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @param {number} minLength - Минимальная длина номера
 * @returns {Array} Массив входящих звонков
 */
async function getInboundCallsByQueueUltraFast(queueNames, startTime, endTime, minLength = 4) {
  const startTotal = Date.now();
  
  // Нормализуем очереди в массив
  const queues = Array.isArray(queueNames) ? queueNames : [queueNames];
  if (queues.length === 0) {
    return [];
  }
  
  // Шаг 1: Получаем события из queuelog (как в PHP)
  const start1 = Date.now();
  const queuePlaceholders = queues.map(() => '?').join(',');
  const [queueRows] = await dbExecute(`
    SELECT 
      q.time, q.callid, q.queuename, q.agent, q.EVENT,
      q.data1 AS wait, q.data2 AS dur
    FROM asteriskcdrdb.queuelog q
    WHERE q.time BETWEEN ? AND ?
      AND q.queuename IN (${queuePlaceholders})
      AND q.EVENT IN ('COMPLETECALLER', 'COMPLETEAGENT', 'ABANDON', 'EXITWITHTIMEOUT')
    ORDER BY q.time DESC
  `, [startTime, endTime, ...queues]);
  const time1 = Date.now() - start1;
  
  if (queueRows.length === 0) {
    return [];
  }
  
  // Шаг 2: Собираем уникальные callid и группируем события
  const callEventsMap = new Map();
  queueRows.forEach(row => {
    if (!callEventsMap.has(row.callid)) {
      callEventsMap.set(row.callid, {
        callid: row.callid,
        queuename: row.queuename,
        agent: row.agent,
        EVENT: row.EVENT,
        wait: row.wait,
        dur: row.dur,
        time: timeToString(row.time)
      });
    } else {
      // Обновляем EVENT если новый более финальный
      const existing = callEventsMap.get(row.callid);
      const finalEvents = ['COMPLETECALLER', 'COMPLETEAGENT', 'ABANDON', 'EXITWITHTIMEOUT'];
      if (finalEvents.indexOf(row.EVENT) < finalEvents.indexOf(existing.EVENT)) {
        existing.EVENT = row.EVENT;
        existing.dur = row.dur;
        existing.wait = row.wait;
        existing.agent = row.agent || existing.agent;
      }
    }
  });
  
  const callIds = [...callEventsMap.keys()];
  
  // Шаг 3: Получаем данные из CDR для этих callid (разбиваем на батчи)
  // Для входящих звонков: src (от клиента) должен быть длинным (> minLength), dst (к очереди) - коротким (<= minLength)
  const start2 = Date.now();
  let cdrRows = [];
  
  for (let i = 0; i < callIds.length; i += BATCH_SIZE) {
    const batch = callIds.slice(i, i + BATCH_SIZE);
    const cdrPlaceholders = batch.map(() => '?').join(',');
    const [batchRows] = await dbExecute(`
      SELECT 
        c.uniqueid, c.linkedid, c.calldate, c.src, c.dst, c.did,
        c.disposition, c.billsec, c.duration, c.recordingfile,
        c.dcontext, c.channel
      FROM asteriskcdrdb.cdr c
      WHERE c.uniqueid IN (${cdrPlaceholders})
        AND (c.channel LIKE 'PJSIP%' OR c.channel LIKE 'SIP%')
        AND CHAR_LENGTH(c.src) > ?
        AND CHAR_LENGTH(c.dst) <= ?
      GROUP BY c.linkedid
      ORDER BY c.calldate DESC
    `, [...batch, minLength, minLength]);
    cdrRows.push(...batchRows);
  }
  const time2 = Date.now() - start2;
  
  // Создаем Map для CDR данных
  const cdrMap = new Map();
  cdrRows.forEach(row => {
    cdrMap.set(row.uniqueid, row);
  });
  
  // Шаг 4: Получаем recordingfile для звонков без записи (разбиваем на батчи)
  const linkedIds = [...new Set(cdrRows.map(r => r.linkedid))];
  let recordingMap = new Map();
  
  if (linkedIds.length > 0) {
    const start3 = Date.now();
    let recordingRows = [];
    
    for (let i = 0; i < linkedIds.length; i += BATCH_SIZE) {
      const batch = linkedIds.slice(i, i + BATCH_SIZE);
      const recPlaceholders = batch.map(() => '?').join(',');
      const [batchRows] = await dbExecute(`
        SELECT linkedid, recordingfile
        FROM asteriskcdrdb.cdr
        WHERE linkedid IN (${recPlaceholders})
          AND disposition = 'ANSWERED'
          AND recordingfile IS NOT NULL
          AND recordingfile != ''
        ORDER BY linkedid, calldate DESC
      `, batch);
      recordingRows.push(...batchRows);
    }
    
    recordingMap = createMap(recordingRows, 'linkedid', 'recordingfile');
  }
  
  // Шаг 5: Объединяем данные и фильтруем по логике PHP
  const start4 = Date.now();
  const calls = [];
  const processedLinkedIds = new Set();
  
  callIds.forEach(callid => {
    const queueData = callEventsMap.get(callid);
    const cdrData = cdrMap.get(callid);
    
    if (!cdrData) return;
    if (processedLinkedIds.has(cdrData.linkedid)) return; // GROUP BY linkedid
    
    const event = (queueData.EVENT || '').trim().toUpperCase();
    const disposition = (cdrData.disposition || '').trim().toUpperCase().replace(/\s+/g, '');
    
    // Логика PHP: фильтрация по EVENT + disposition
    const isSuccess = (event === 'COMPLETECALLER' || event === 'COMPLETEAGENT') && 
                     disposition === 'ANSWERED';
    const isAbandoned = (event === 'ABANDON' || event === 'EXITWITHTIMEOUT') && 
                       (disposition === 'NOANSWER' || disposition === 'NO ANSWER');
    
    if (!isSuccess && !isAbandoned) return;
    
    processedLinkedIds.add(cdrData.linkedid);
    
    // Определяем статус (логика PHP: dur <= 5 = пропущенный)
    const status = getStatusFromEvent(event, disposition, queueData.dur);
    
    // Получаем recordingfile
    const recordingFile = cdrData.recordingfile || recordingMap.get(cdrData.linkedid) || null;
    
    calls.push({
      callId: cdrData.uniqueid,
      linkedid: cdrData.linkedid,
      clientNumber: cdrData.src,
      destination: cdrData.dst || cdrData.did,
      startTime: timeToString(queueData.time || cdrData.calldate),
      endTime: timeToString(cdrData.calldate),
      status: status,
      duration: cdrData.billsec || queueData.dur || 0,
      waitTime: queueData.wait || null,
      recordingFile: recordingFile,
      dcontext: cdrData.dcontext,
      channel: cdrData.channel,
      queuename: queueData.queuename,
      agent: queueData.agent,
      EVENT: queueData.EVENT,
      isOutbound: false
    });
  });
  const time4 = Date.now() - start4;
  
  const totalTime = Date.now() - startTotal;
  
  if (process.env.DEBUG_DB === 'true') {
    logger.info(`[UltraFast Inbound Queue] queuelog: ${time1}ms, cdr: ${time2}ms, обработка: ${time4}ms, всего: ${totalTime}ms, звонков: ${calls.length}`);
  }
  
  return calls;
}

// =============================================================================
// ИСХОДЯЩИЕ ЗВОНКИ (OUTBOUND)
// =============================================================================

/**
 * UltraFast: Получение исходящих звонков
 * Стратегия: 2 запроса + Map
 * 
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @param {number} minLength - Минимальная длина номера
 * @returns {Array} Массив исходящих звонков
 */
async function getOutboundCallsUltraFast(startTime, endTime, minLength = 4) {
  const startTotal = Date.now();
  
  // Шаг 1: Получаем базовые данные исходящих
  const start1 = Date.now();
  const [rows] = await dbExecute(`
    SELECT 
      c.calldate, c.uniqueid, c.linkedid, c.src, c.dst, 
      c.disposition, c.billsec, c.duration,
      c.dcontext, c.channel, c.lastapp, c.lastdata,
      c.outbound_cnum, c.cnum, c.cnam
    FROM asteriskcdrdb.cdr c
    WHERE c.calldate BETWEEN ? AND ?
      AND c.outbound_cnum IS NOT NULL 
      AND c.outbound_cnum != ''
      AND CHAR_LENGTH(c.outbound_cnum) >= ?
      AND (c.lastapp IS NULL OR c.lastapp != 'Hangup')
      AND c.dst IS NOT NULL
      AND c.dst != ''
      AND CHAR_LENGTH(c.dst) > ?
    ORDER BY c.calldate DESC
  `, [startTime, endTime, minLength, minLength]);
  const time1 = Date.now() - start1;
  
  if (rows.length === 0) {
    return [];
  }
  
  // Шаг 2: Собираем уникальные linkedid
  const linkedIds = [...new Set(rows.map(r => r.linkedid))];
  
  // Шаг 3: Получаем recordingfile (разбиваем на батчи для избежания ошибки "too many placeholders")
  const start2 = Date.now();
  let recordingRows = [];
  
  // Разбиваем linkedIds на батчи
  for (let i = 0; i < linkedIds.length; i += BATCH_SIZE) {
    const batch = linkedIds.slice(i, i + BATCH_SIZE);
    const placeholders = batch.map(() => '?').join(',');
    const [batchRows] = await dbExecute(`
      SELECT linkedid, recordingfile
      FROM asteriskcdrdb.cdr
      WHERE linkedid IN (${placeholders})
        AND disposition = 'ANSWERED'
        AND recordingfile IS NOT NULL
        AND recordingfile != ''
      ORDER BY linkedid, calldate DESC
    `, batch);
    recordingRows.push(...batchRows);
  }
  const time2 = Date.now() - start2;
  
  // Шаг 4: Создаем Map
  const recordingMap = createMap(recordingRows, 'linkedid', 'recordingfile');
  
  // Шаг 5: Обрабатываем в памяти
  const start3 = Date.now();
  const calls = rows.map(row => ({
    callId: row.uniqueid,
    linkedid: row.linkedid,
    clientNumber: row.src,
    destination: row.dst,
    startTime: timeToString(row.calldate),
    endTime: timeToString(row.calldate),
    status: normalizeDisposition(row.disposition),
    duration: row.billsec || 0,
    waitTime: null,
    recordingFile: recordingMap.get(row.linkedid) || null,
    dcontext: row.dcontext,
    channel: row.channel,
    outbound_cnum: row.outbound_cnum,
    cnum: row.cnum,
    cnam: row.cnam,
    isOutbound: true
  }));
  const time3 = Date.now() - start3;
  
  const totalTime = Date.now() - startTotal;
  
  if (process.env.DEBUG_DB === 'true') {
    logger.info(`[UltraFast Outbound] cdr: ${time1}ms, recordings: ${time2}ms, обработка: ${time3}ms, всего: ${totalTime}ms, звонков: ${calls.length}`);
  }
  
  return calls;
}

/**
 * UltraFast: Получение исходящих звонков очереди
 * Стратегия: 2 запроса + Map
 * 
 * @param {string} queueName - Название очереди
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @returns {Array} Массив исходящих звонков очереди
 */
async function getOutboundQueueCallsUltraFast(queueName, startTime, endTime) {
  const startTotal = Date.now();
  
  // Шаг 1: Получаем агентов очереди
  const start1 = Date.now();
  const [agentRows] = await dbExecute(`
    SELECT DISTINCT data
    FROM asterisk.queues_details
    WHERE id = ?
      AND data REGEXP 'Local/'
  `, [queueName]);
  const time1 = Date.now() - start1;
  
  if (agentRows.length === 0) {
    return [];
  }
  
  // Извлекаем номера агентов
  const agentNumbers = agentRows
    .map(row => {
      const match = (row.data || '').match(/Local\/(\d+)@/);
      return match ? match[1] : null;
    })
    .filter(n => n !== null);
  
  if (agentNumbers.length === 0) {
    return [];
  }
  
  // Шаг 2: Получаем исходящие звонки агентов
  const start2 = Date.now();
  const agentPlaceholders = agentNumbers.map(() => '?').join(',');
  const [rows] = await dbExecute(`
    SELECT 
      c.calldate, c.uniqueid, c.linkedid, c.src, c.dst, 
      c.disposition, c.billsec, c.duration,
      c.dcontext, c.channel, c.lastapp, c.lastdata,
      c.outbound_cnum, c.cnum, c.cnam
    FROM asteriskcdrdb.cdr c
    WHERE c.calldate BETWEEN ? AND ?
      AND c.cnum IN (${agentPlaceholders})
      AND CHAR_LENGTH(c.outbound_cnum) >= 4
      AND (c.lastapp IS NULL OR c.lastapp != 'Hangup')
      AND c.dst IS NOT NULL
      AND CHAR_LENGTH(c.dst) > 4
    ORDER BY c.calldate DESC
  `, [startTime, endTime, ...agentNumbers]);
  const time2 = Date.now() - start2;
  
  if (rows.length === 0) {
    return [];
  }
  
  // Шаг 3: Получаем recordingfile (разбиваем на батчи для избежания ошибки "too many placeholders")
  const linkedIds = [...new Set(rows.map(r => r.linkedid))];
  const start3 = Date.now();
  let recordingRows = [];
  
  for (let i = 0; i < linkedIds.length; i += BATCH_SIZE) {
    const batch = linkedIds.slice(i, i + BATCH_SIZE);
    const recPlaceholders = batch.map(() => '?').join(',');
    const [batchRows] = await dbExecute(`
      SELECT linkedid, recordingfile
      FROM asteriskcdrdb.cdr
      WHERE linkedid IN (${recPlaceholders})
        AND disposition = 'ANSWERED'
        AND recordingfile IS NOT NULL
        AND recordingfile != ''
      ORDER BY linkedid, calldate DESC
    `, batch);
    recordingRows.push(...batchRows);
  }
  const time3 = Date.now() - start3;
  
  // Шаг 4: Создаем Map
  const recordingMap = createMap(recordingRows, 'linkedid', 'recordingfile');
  
  // Шаг 5: Обрабатываем в памяти
  const start4 = Date.now();
  const calls = rows.map((row, idx) => {
    // Отладка для первых 3 звонков
    if (idx < 3 && process.env.DEBUG_DB === 'true') {
      logger.info(`[DEBUG OutboundQueue] row.calldate:`, row.calldate, 'type:', typeof row.calldate, 'isDate:', row.calldate instanceof Date);
      if (row.calldate instanceof Date) {
        logger.info(`[DEBUG] Date.getHours():`, row.calldate.getHours(), 'toISOString():', row.calldate.toISOString());
      }
      logger.info(`[DEBUG] timeToString result:`, timeToString(row.calldate));
    }
    
    return {
      callId: row.uniqueid,
      linkedid: row.linkedid,
      clientNumber: row.src,
      destination: row.dst,
      startTime: timeToString(row.calldate),
      endTime: timeToString(row.calldate),
      status: normalizeDisposition(row.disposition),
      duration: row.billsec || 0,
      waitTime: null,
      recordingFile: recordingMap.get(row.linkedid) || null,
      dcontext: row.dcontext,
      channel: row.channel,
      outbound_cnum: row.outbound_cnum,
      cnum: row.cnum,
      cnam: row.cnam,
      agent: row.cnum,
      isOutbound: true
    };
  });
  const time4 = Date.now() - start4;
  
  const totalTime = Date.now() - startTotal;
  
  if (process.env.DEBUG_DB === 'true') {
    logger.info(`[UltraFast Outbound Queue] agents: ${time1}ms, cdr: ${time2}ms, recordings: ${time3}ms, обработка: ${time4}ms, всего: ${totalTime}ms, звонков: ${calls.length}`);
  }
  
  return calls;
}

// =============================================================================
// ЭКСПОРТ
// =============================================================================

module.exports = {
  // Очереди
  getQueueCallsUltraFast,
  getQueueCallsSubquery,
  
  // Входящие
  getInboundCallsUltraFast,           // Все входящие (без фильтра по очереди)
  getInboundCallsByQueueUltraFast,    // Входящие с фильтром по очереди (как в PHP)
  
  // Исходящие
  getOutboundCallsUltraFast,
  getOutboundQueueCallsUltraFast,
  
  // Утилиты
  normalizeDisposition,
  getStatusFromEvent,
  createMap
};
