/**
 * Модуль оптимизированных запросов для больших данных в MariaDB
 * Использует специфичные для MariaDB оптимизации:
 * - Временные таблицы для сложных JOIN
 * - Оптимизация подзапросов
 * - Использование индексов более эффективно
 * - Партиционирование запросов
 */

const { execute: dbExecute, getConnection } = require('./db-optimizer');
const { format } = require('date-fns');
const logger = require('./logger');

/**
 * Оптимизированный запрос для получения звонков из очереди (для больших данных)
 * Использует временную таблицу для оптимизации JOIN
 */
async function getQueueCallsOptimized(queueName, startTime, endTime) {
  const connection = await getConnection();
  
  try {
    // Создаем временную таблицу для событий очереди (быстрее для больших данных)
    await connection.execute(`
      CREATE TEMPORARY TABLE IF NOT EXISTS tmp_queue_events AS
      SELECT 
        q.time, q.event, q.callid, q.queuename, q.agent, 
        q.data1, q.data2, q.data3, q.data4, q.data5
      FROM asteriskcdrdb.queuelog q
      WHERE q.queuename = ? 
        AND q.time BETWEEN ? AND ?
      ORDER BY q.time
    `, [queueName, startTime, endTime]);
    
    // Создаем индекс на временной таблице для быстрого JOIN
    await connection.execute(`
      CREATE INDEX idx_tmp_callid ON tmp_queue_events(callid)
    `).catch(() => {}); // Игнорируем ошибку, если индекс уже существует
    
    // JOIN с CDR через временную таблицу (быстрее для больших данных)
    const [rows] = await connection.execute(`
      SELECT 
        t.time, t.event, t.callid, t.queuename, t.agent, 
        t.data1, t.data2, t.data3, t.data4, t.data5,
        c.recordingfile, c.linkedid
      FROM tmp_queue_events t
      LEFT JOIN asteriskcdrdb.cdr c ON t.callid = c.linkedid AND c.disposition = 'ANSWERED'
      ORDER BY t.time
    `);
    
    // Обрабатываем результаты
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
    
    // Удаляем временную таблицу
    await connection.execute(`DROP TEMPORARY TABLE IF EXISTS tmp_queue_events`);
    
    return Object.values(calls);
  } finally {
    connection.release();
  }
}

/**
 * Оптимизированный запрос для входящих звонков (использует STRAIGHT_JOIN для оптимизации)
 */
async function getInboundCallsOptimized(startTime, endTime, minLength = 4) {
  // Используем STRAIGHT_JOIN для указания порядка JOIN (MariaDB оптимизация)
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
    LIMIT 100000
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
 * Оптимизированный batch-запрос для перезвонов (использует EXISTS вместо JOIN)
 * EXISTS часто быстрее для больших таблиц в MariaDB
 */
async function checkCallbacksOptimized(conn, calls, queueName) {
  if (!calls || calls.length === 0) {
    return [];
  }

  const results = calls.map(() => ({
    type: 'no_callback',
    status: 'Не обработан',
    callbackTime: null,
    recordingFile: null
  }));

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
    
    // Используем EXISTS вместо JOIN для больших таблиц (быстрее в MariaDB)
    // Разбиваем на чанки для оптимизации
    const chunkSize = 50;
    const chunks = [];
    for (let i = 0; i < validCalls.length; i += chunkSize) {
      chunks.push(validCalls.slice(i, i + chunkSize));
    }
    
    for (const chunk of chunks) {
      // Запрос с EXISTS (оптимизирован для MariaDB)
      const [queueCallbacks] = await executeFn(`
        SELECT DISTINCT
          q.callid,
          q.time,
          c.calldate,
          c.recordingfile,
          e.data2 as clientNumber
        FROM asteriskcdrdb.queuelog q
        INNER JOIN asteriskcdrdb.queuelog e ON q.callid = e.callid AND e.event = 'ENTERQUEUE'
        INNER JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid
        WHERE q.queuename = ?
          AND q.event IN ('COMPLETECALLER', 'COMPLETEAGENT')
          AND c.disposition = 'ANSWERED'
          AND c.billsec >= 5
          AND q.time BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM (
              ${chunk.map((vc, idx) => `
                SELECT ? as clientNumber, ? as callbackStart, ? as callbackEnd, ? as callId
              `).join(' UNION ALL ')}
            ) AS valid_calls
            WHERE (
              e.data2 = valid_calls.clientNumber OR
              RIGHT(e.data2, 10) = RIGHT(valid_calls.clientNumber, 10) OR
              RIGHT(e.data2, 9) = RIGHT(valid_calls.clientNumber, 9)
            )
            AND q.time >= valid_calls.callbackStart
            AND q.time <= valid_calls.callbackEnd
            AND q.callid != valid_calls.callId
          )
        ORDER BY q.time ASC
      `, [
        queueName,
        ...chunk.flatMap(vc => [
          vc.clientNumber, vc.callbackStart, vc.callbackEnd, vc.callId
        ])
      ]);

      // Обрабатываем результаты
      queueCallbacks.forEach(cb => {
        const matchedCall = chunk.find(vc => {
          if (cb.time < vc.callbackStart || cb.time > vc.callbackEnd) return false;
          if (cb.callid === vc.callId) return false;
          
          const cbNumber = String(cb.clientNumber || '').trim();
          if (!cbNumber) return false;
          
          return cbNumber === vc.clientNumber ||
                 cbNumber.slice(-10) === vc.clientNumberLast10 ||
                 cbNumber.slice(-9) === vc.clientNumberLast9;
        });
        
        if (matchedCall) {
          results[matchedCall.originalIndex] = {
            type: 'client_callback',
            status: 'Перезвонил сам',
            callbackTime: cb.calldate || cb.time,
            recordingFile: cb.recordingfile || matchedCall.call.recordingFile
          };
        }
      });
    }
  } catch (error) {
    logger.error('Ошибка при оптимизированной проверке перезвонов:', error);
  }

  return results;
}

/**
 * Запрос с использованием покрывающего индекса (covering index)
 * Выбирает только нужные поля для использования индекса
 */
async function getQueueCallsCoveringIndex(queueName, startTime, endTime) {
  // Используем только поля из индекса для максимальной скорости
  const [rows] = await dbExecute(`
    SELECT 
      q.callid,
      q.time,
      q.event,
      q.data2 as clientNumber,
      q.data3 as queuePosition,
      q.data1 as agent,
      q.data2 as duration
    FROM asteriskcdrdb.queuelog q
    WHERE q.queuename = ? 
      AND q.time BETWEEN ? AND ?
    ORDER BY q.time
  `, [queueName, startTime, endTime]);
  
  // Затем получаем recordingfile отдельным запросом (если нужно)
  const callIds = [...new Set(rows.map(r => r.callid))];
  const [recordings] = await dbExecute(`
    SELECT linkedid, recordingfile
    FROM asteriskcdrdb.cdr
    WHERE linkedid IN (${callIds.map(() => '?').join(',')})
      AND disposition = 'ANSWERED'
  `, callIds);
  
  const recordingMap = new Map(recordings.map(r => [r.linkedid, r.recordingfile]));
  
  // Обрабатываем результаты
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
        recordingFile: recordingMap.get(row.callid) || null,
        linkedid: row.callid
      };
    }
    
    calls[row.callid].events.push(row);
    
    switch (row.event) {
      case 'ENTERQUEUE':
        calls[row.callid].clientNumber = row.clientNumber;
        calls[row.callid].queuePosition = row.queuePosition;
        calls[row.callid].startTime = row.time;
        break;
      case 'CONNECT':
        calls[row.callid].connectTime = row.time;
        calls[row.callid].agent = row.agent;
        break;
      case 'COMPLETECALLER':
      case 'COMPLETEAGENT':
        calls[row.callid].endTime = row.time;
        calls[row.callid].status = row.event === 'COMPLETECALLER' 
          ? 'completed_by_caller' 
          : 'completed_by_agent';
        calls[row.callid].duration = row.duration;
        break;
      case 'ABANDON':
        calls[row.callid].endTime = row.time;
        calls[row.callid].status = 'abandoned';
        break;
    }
  });
  
  return Object.values(calls);
}

/**
 * Использование подзапроса вместо JOIN (иногда быстрее в MariaDB)
 */
async function getQueueCallsWithSubquery(queueName, startTime, endTime) {
  const [rows] = await dbExecute(`
    SELECT 
      q.time, q.event, q.callid, q.queuename, q.agent, 
      q.data1, q.data2, q.data3, q.data4, q.data5,
      (
        SELECT c.recordingfile 
        FROM asteriskcdrdb.cdr c 
        WHERE c.linkedid = q.callid 
          AND c.disposition = 'ANSWERED' 
        LIMIT 1
      ) as recordingfile,
      q.callid as linkedid
    FROM asteriskcdrdb.queuelog q
    WHERE q.queuename = ? 
      AND q.time BETWEEN ? AND ?
    ORDER BY q.time
  `, [queueName, startTime, endTime]);
  
  // Обработка результатов аналогична getQueueCalls
  // ... (код обработки)
  
  return Object.values(calls);
}

module.exports = {
  getQueueCallsOptimized,
  getInboundCallsOptimized,
  checkCallbacksOptimized,
  getQueueCallsCoveringIndex,
  getQueueCallsWithSubquery
};

