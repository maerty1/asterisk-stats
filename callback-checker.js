/**
 * Модуль для проверки перезвонов (callbacks)
 * Обеспечивает единую логику проверки перезвонов для аналитики и рейтинга
 */

const { format } = require('date-fns');
const { execute: dbExecute } = require('./db-optimizer');

/**
 * Проверка перезвонов для пропущенных звонков в очереди
 * Единая функция, используемая как в аналитике, так и в рейтинге
 * 
 * @param {Object|null} conn - Соединение с БД (опционально, если null - используется dbExecute)
 * @param {Array} calls - Массив звонков для проверки
 * @param {String} queueName - Название очереди
 * @returns {Array} Массив результатов проверки перезвонов
 */
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
          const vcItem = callsWithoutQueueCallbackMap.get(idx);
          results[idx] = {
            type: 'agent_callback',
            status: 'Перезвонили мы',
            callbackTime: cb.calldate,
            recordingFile: cb.recordingfile || (vcItem && vcItem.call ? vcItem.call.recordingFile : null)
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
    console.error('[checkCallbacksBatch] Ошибка при batch-проверке перезвонов:', error);
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

/**
 * Проверка перезвонов для входящих звонков (без привязки к очереди)
 * 
 * @param {Object|null} conn - Соединение с БД (опционально)
 * @param {Array} calls - Массив звонков для проверки
 * @returns {Array} Массив результатов проверки перезвонов
 */
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
    // Определяем функцию для выполнения запроса
    const executeFn = (conn && typeof conn.execute === 'function') 
      ? conn.execute.bind(conn) 
      : dbExecute;

    // Параллельно выполняем оба запроса для перезвонов от клиента и от агента
    const [cdrClientCallbacks, cdrAgentCallbacks] = await Promise.all([
      // Запрос для перезвонов от клиента (входящие звонки)
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
            ${validCalls.map(() => `
              (c.calldate >= ? AND c.calldate <= ? AND (
                c.src LIKE ? OR c.src LIKE ? OR 
                RIGHT(c.src, 10) = ? OR RIGHT(c.src, 9) = ? OR
                c.src = ?
              ))
            `).join(' OR ')}
          )
        ORDER BY c.calldate ASC
      `, validCalls.flatMap(vc => [
        vc.callbackStart, vc.callbackEnd,
        `%${vc.clientNumberLast10}`, `%${vc.clientNumberLast9}`,
        vc.clientNumberLast10, vc.clientNumberLast9, vc.clientNumber
      ])),
      // Запрос для перезвонов от агента (исходящие звонки)
      executeFn(`
        SELECT 
          c.calldate, c.uniqueid, c.billsec, c.disposition,
          c.recordingfile, c.src, c.dst, c.dcontext,
          c.dst as matched_number
        FROM asteriskcdrdb.cdr c
        WHERE c.disposition = 'ANSWERED'
          AND c.billsec >= 5
          AND (c.dcontext LIKE 'outbound%' OR c.dcontext LIKE 'from-internal%' OR c.dcontext LIKE 'ext-local%')
          AND (
            ${validCalls.map(() => `
              (c.calldate >= ? AND c.calldate <= ? AND (
                c.dst LIKE ? OR c.dst LIKE ? OR 
                RIGHT(c.dst, 10) = ? OR RIGHT(c.dst, 9) = ? OR
                c.dst = ?
              ))
            `).join(' OR ')}
          )
        ORDER BY c.calldate ASC
      `, validCalls.flatMap(vc => [
        vc.callbackStart, vc.callbackEnd,
        `%${vc.clientNumberLast10}`, `%${vc.clientNumberLast9}`,
        vc.clientNumberLast10, vc.clientNumberLast9, vc.clientNumber
      ]))
    ]);

    // Обработка перезвонов от клиента (приоритет)
    const clientCallbackMap = new Map();
    cdrClientCallbacks[0].forEach(cb => {
      const cbSrc = String(cb.src || '').trim();
      if (!cbSrc) return;
      
      validCalls.forEach(vc => {
        if (clientCallbackMap.has(vc.originalIndex)) return;
        if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return;
        
        const matches = cbSrc === vc.clientNumber ||
                     cbSrc.slice(-10) === vc.clientNumberLast10 ||
                     cbSrc.slice(-9) === vc.clientNumberLast9 ||
                     vc.clientNumber.slice(-10) === cbSrc.slice(-10) ||
                     vc.clientNumber.slice(-9) === cbSrc.slice(-9);
        
        if (matches) {
          clientCallbackMap.set(vc.originalIndex, cb);
        }
      });
    });

    // Обработка перезвонов от агента (только если не найден перезвон от клиента)
    const agentCallbackMap = new Map();
    cdrAgentCallbacks[0].forEach(cb => {
      const cbDst = String(cb.dst || '').trim();
      if (!cbDst) return;
      
      validCalls.forEach(vc => {
        if (clientCallbackMap.has(vc.originalIndex)) return;
        if (agentCallbackMap.has(vc.originalIndex)) return;
        if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return;
        
        const matches = cbDst === vc.clientNumber ||
                       cbDst.slice(-10) === vc.clientNumberLast10 ||
                       cbDst.slice(-9) === vc.clientNumberLast9 ||
                       vc.clientNumber.slice(-10) === cbDst.slice(-10) ||
                       vc.clientNumber.slice(-9) === cbDst.slice(-9);
        
        if (matches) {
          agentCallbackMap.set(vc.originalIndex, cb);
        }
      });
    });

    // Применяем результаты перезвонов от клиентов (приоритет)
    clientCallbackMap.forEach((cb, idx) => {
      const vc = validCalls.find(v => v.originalIndex === idx);
      if (vc) {
        results[idx] = {
          type: 'client_callback',
          status: 'Перезвонил сам',
          callbackTime: cb.calldate,
          recordingFile: cb.recordingfile || vc.call.recordingFile
        };
      }
    });

    // Применяем результаты перезвонов от агентов (только если не найден перезвон от клиента)
    agentCallbackMap.forEach((cb, idx) => {
      if (!clientCallbackMap.has(idx)) {
        const vc = validCalls.find(v => v.originalIndex === idx);
        if (vc) {
          results[idx] = {
            type: 'agent_callback',
            status: 'Перезвонили мы',
            callbackTime: cb.calldate,
            recordingFile: cb.recordingfile || vc.call.recordingFile
          };
        }
      }
    });

  } catch (error) {
    console.error('[checkCallbacksBatchInbound] Ошибка при batch-проверке перезвонов:', error);
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

module.exports = {
  checkCallbacksBatch,
  checkCallbacksBatchInbound
};

