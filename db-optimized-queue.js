/**
 * Оптимизированная версия запроса для получения звонков очереди
 * Максимальная скорость для конкретного случая: очередь 1049, 1 день
 */

const { execute: dbExecute, getConnection } = require('./db-optimizer');

/**
 * Оптимизированный запрос с покрывающим индексом и минимальным JOIN
 * Стратегия:
 * 1. Получаем данные из queuelog (основная таблица)
 * 2. Получаем recordingfile отдельным запросом только для нужных callid
 * 3. Объединяем в памяти
 */
async function getQueueCallsUltraFast(queueName, startTime, endTime) {
  const startTotal = Date.now();
  
  // Шаг 1: Получаем все события очереди (быстро, используя индекс по queue+time)
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
  
  // Шаг 2: Собираем уникальные callid
  const callIds = [...new Set(queueRows.map(r => r.callid))];
  
  if (callIds.length === 0) {
    return [];
  }
  
  // Шаг 3: Получаем recordingfile только для нужных звонков (быстрый IN запрос)
  // Приоритет: записи формата q-{queuename}-... (записи очереди), затем другие
  const start2 = Date.now();
  const placeholders = callIds.map(() => '?').join(',');
  const [cdrRows] = await dbExecute(`
    SELECT linkedid, recordingfile,
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
  `, [`q-${queueName}-%`, ...callIds]);
  const time2 = Date.now() - start2;
  
  // Шаг 4: Создаем Map для быстрого поиска recordingfile (берем первую запись для каждого linkedid)
  const recordingMap = new Map();
  cdrRows.forEach(r => {
    if (!recordingMap.has(r.linkedid)) {
      recordingMap.set(r.linkedid, r.recordingfile);
    }
  });
  
  // Шаг 5: Обрабатываем результаты в памяти (быстро)
  const start3 = Date.now();
  const calls = {};
  
  queueRows.forEach(row => {
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
        linkedid: row.callid
      };
    }
    
    calls[row.callid].events.push(row);
    
    // Обновляем recordingFile из Map
    const recording = recordingMap.get(row.callid);
    if (recording) {
      calls[row.callid].recordingFile = recording;
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
  
  const result = Object.values(calls);
  const time3 = Date.now() - start3;
  const totalTime = Date.now() - startTotal;
  
  if (process.env.DEBUG_DB === 'true') {
    console.log(`[UltraFast] Запрос queuelog: ${time1}ms, запрос cdr: ${time2}ms, обработка: ${time3}ms, всего: ${totalTime}ms`);
  }
  
  return result;
}

/**
 * Запрос с использованием подзапроса вместо JOIN (может быть быстрее)
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

  // Обработка результатов (та же логика)
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

module.exports = {
  getQueueCallsUltraFast,
  getQueueCallsSubquery
};

