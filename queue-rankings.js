/**
 * Модуль для расчета рейтингов очередей
 */

const { execute: dbExecute, pool } = require('./db-optimizer');
const { getQueueCallsUltraFast } = require('./db-optimized-queue');
const { calculateStatsSimple } = require('./queue-rankings-helper');
const { format } = require('date-fns');
const { checkCallbacksBatch } = require('./callback-checker');

// Импортируем функцию форматирования названия очереди из app.js
// Так как app.js не экспортирует, создадим свою версию здесь
let queueNamesCache = {};
let queueNamesCacheTime = 0;
const QUEUES_CACHE_TTL = 5 * 60 * 1000; // 5 минут

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
  } catch (err) {
    console.error('Ошибка при загрузке названий очередей:', err);
    queueNamesCache = {};
  }
}

function formatQueueName(queueNumber) {
  const now = Date.now();
  if (now - queueNamesCacheTime > QUEUES_CACHE_TTL || Object.keys(queueNamesCache).length === 0) {
    refreshQueueNamesCache().catch(err => {
      console.error('Ошибка при обновлении кэша названий очередей:', err);
    });
  }
  
  const name = queueNamesCache[queueNumber];
  return name ? `${queueNumber} (${name})` : queueNumber;
}

// Импортируем checkCallbacksBatch из app.js через require
// Так как app.js не экспортирует, нужно будет скопировать логику или вызвать через другой способ
// Для начала используем упрощенную версию без перезвонов

/**
 * Извлечь отдел из названия очереди
 * @param {string} queueDescription - Описание очереди, например "Автозаводский - ОП"
 * @returns {string|null} Отдел (ОП, Рецепция, Коммун центр) или null
 */
function extractDepartment(queueDescription) {
  if (!queueDescription) return null;
  
  // Ищем отдел после " - " или "-"
  const parts = queueDescription.split(/[\s]*[-\u2013\u2014][\s]*/);
  if (parts.length >= 2) {
    const department = parts[parts.length - 1].trim();
    // Нормализуем название отдела
    if (department.includes('Коммун')) {
      return 'Коммун центр';
    }
    return department;
  }
  
  return null;
}

/**
 * Упрощенная версия checkCallbacksBatch для рейтинга
 * Проверяет перезвоны для пропущенных звонков в очереди
 */
async function checkCallbacksBatchForRankings(conn, calls, queueName) {
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
    const executeFn = (conn && typeof conn.execute === 'function') 
      ? conn.execute.bind(conn) 
      : dbExecute;

    // Batch-запрос для поиска перезвонов в очереди (client callbacks)
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
      const matchedCall = validCalls.find(vc => {
        if (cb.time < vc.callbackStart || cb.time > vc.callbackEnd) return false;
        if (cb.callid === vc.callId) return false;
        
        const cbNumber = String(cb.clientNumber || '').trim();
        if (!cbNumber) return false;
        
        return cbNumber === vc.clientNumber ||
               cbNumber.slice(-10) === vc.clientNumberLast10 ||
               cbNumber.slice(-9) === vc.clientNumberLast9 ||
               vc.clientNumber.slice(-10) === cbNumber.slice(-10) ||
               vc.clientNumber.slice(-9) === cbNumber.slice(-9);
      });
      if (matchedCall && !queueCallbackMap.has(matchedCall.originalIndex)) {
        queueCallbackMap.set(matchedCall.originalIndex, {
          type: 'client',
          status: 'Перезвонил сам',
          callbackTime: cb.calldate,
          recordingFile: cb.recordingfile
        });
      }
    });

    // Поиск перезвонов от клиента в CDR и от агента (параллельно)
    const callsWithoutQueueCallback = validCalls.filter(vc => !queueCallbackMap.has(vc.originalIndex));
    
    if (callsWithoutQueueCallback.length > 0) {
      // Параллельно выполняем оба запроса (как в основной функции)
      const [cdrClientCallbacks, cdrAgentCallbacks] = await Promise.all([
        // Запрос для перезвонов от клиента в CDR (входящие звонки)
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

      // Обрабатываем перезвоны от клиента в CDR (приоритет)
      // Важно: результат executeFn возвращает [rows], поэтому берем [0]
      (cdrClientCallbacks[0] || []).forEach(cb => {
        const cbSrc = String(cb.src || '').trim();
        if (!cbSrc) return;
        
        const matchedCall = callsWithoutQueueCallback.find(vc => {
          if (queueCallbackMap.has(vc.originalIndex)) return false;
          if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return false;
          
          return cbSrc === vc.clientNumber ||
                 cbSrc.slice(-10) === vc.clientNumberLast10 ||
                 cbSrc.slice(-9) === vc.clientNumberLast9 ||
                 vc.clientNumber.slice(-10) === cbSrc.slice(-10) ||
                 vc.clientNumber.slice(-9) === cbSrc.slice(-9);
        });
        
        if (matchedCall && !queueCallbackMap.has(matchedCall.originalIndex)) {
          queueCallbackMap.set(matchedCall.originalIndex, {
            type: 'client',
            status: 'Перезвонил сам',
            callbackTime: cb.calldate,
            recordingFile: cb.recordingfile
          });
        }
      });

      // Обрабатываем перезвоны от агента (только если не найден перезвон от клиента)
      // Создаем отдельную мапу для перезвонов от агента (как в основной функции)
      const agentCallbackMap = new Map();
      // Важно: результат executeFn возвращает [rows], поэтому берем [0]
      (cdrAgentCallbacks[0] || []).forEach(cb => {
        const cbDst = String(cb.dst || '').trim();
        if (!cbDst) return;
        
        const matchedCall = callsWithoutQueueCallback.find(vc => {
          if (queueCallbackMap.has(vc.originalIndex)) return false;
          if (cb.calldate < vc.callbackStart || cb.calldate > vc.callbackEnd) return false;
          
          return cbDst === vc.clientNumber ||
                 cbDst.slice(-10) === vc.clientNumberLast10 ||
                 cbDst.slice(-9) === vc.clientNumberLast9 ||
                 vc.clientNumber.slice(-10) === cbDst.slice(-10) ||
                 vc.clientNumber.slice(-9) === cbDst.slice(-9);
        });
        
        if (matchedCall && !queueCallbackMap.has(matchedCall.originalIndex) && !agentCallbackMap.has(matchedCall.originalIndex)) {
          agentCallbackMap.set(matchedCall.originalIndex, cb);
        }
      });

      // Применяем результаты перезвонов от агентов (только если не найден перезвон от клиента)
      agentCallbackMap.forEach((cb, originalIndex) => {
        if (!queueCallbackMap.has(originalIndex)) {
          const vc = validCalls.find(v => v.originalIndex === originalIndex);
          results[originalIndex] = {
            type: 'agent',
            status: 'Перезвонили мы',
            callbackTime: cb.calldate,
            recordingFile: cb.recordingfile || (vc ? vc.call.recordingFile : null)
          };
        }
      });
    }

    // Применяем результаты перезвонов от клиентов (в очереди и в CDR)
    // Это делается после перезвонов от агента, чтобы перезвоны от клиента имели приоритет
    queueCallbackMap.forEach((cb, originalIndex) => {
      const vc = validCalls.find(v => v.originalIndex === originalIndex);
      // Проверяем тип объекта в queueCallbackMap
      if (cb.status && (cb.status === 'Перезвонил сам' || cb.status === 'Перезвонили мы')) {
        // Это уже готовый объект с полями type, status и т.д.
        results[originalIndex] = cb;
      } else if (cb.calldate || cb.time) {
        // Это raw объект из CDR или queuelog, нужно преобразовать
        results[originalIndex] = {
          type: 'client',
          status: 'Перезвонил сам',
          callbackTime: cb.calldate || cb.time,
          recordingFile: cb.recordingfile || (vc ? vc.call.recordingFile : null)
        };
      }
    });

    return results;
  } catch (error) {
    console.error(`[checkCallbacksBatchForRankings] Ошибка при проверке перезвонов для очереди ${queueName}:`, error.message);
    // В случае ошибки возвращаем результаты с "Не обработан"
    return results;
  }
}

/**
 * Получить рейтинг очередей за период
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @param {string} sortBy - Критерий сортировки: 'answerRate', 'sla', 'volume', 'composite'
 * @param {string} departmentFilter - Фильтр по отделу: 'OP', 'Recepcia', 'Kommun', null (все)
 * @returns {Promise<Array>} Массив с рейтингом очередей
 */
async function getQueueRankings(startTime, endTime, sortBy = 'composite', departmentFilter = null) {
  try {
    // Обновляем кэш названий очередей при первом запросе
    if (Object.keys(queueNamesCache).length === 0) {
      await refreshQueueNamesCache();
    }
    
    console.log(`[getQueueRankings] Начало расчета рейтинга: ${startTime} - ${endTime}`);
    
    // Получаем список всех активных очередей за период
    const [queues] = await dbExecute(`
      SELECT DISTINCT queuename
      FROM asteriskcdrdb.queuelog
      WHERE queuename IS NOT NULL 
        AND queuename != 'NONE'
        AND time BETWEEN ? AND ?
      ORDER BY queuename
    `, [startTime, endTime]);

    console.log(`[getQueueRankings] Найдено очередей: ${queues ? queues.length : 0}`);

    if (!queues || queues.length === 0) {
      console.log(`[getQueueRankings] Нет очередей за период, возвращаем пустой массив`);
      return [];
    }

    // Получаем статистику для каждой очереди (параллельно для ускорения)
    const rankingsPromises = queues.map(async (queueRow) => {
      const queueName = queueRow.queuename;
      
      try {
        // Используем UltraFast запрос для максимальной скорости
        const calls = await getQueueCallsUltraFast(queueName, startTime, endTime);
        
        if (calls.length === 0) {
          return null;
        }

        // Получаем описание очереди для фильтрации по отделу (перед расчетом статистики для оптимизации)
        const queueDescription = queueNamesCache[queueName] || null;
        const department = extractDepartment(queueDescription);
        
        // Применяем фильтр по отделу, если указан (до расчета статистики для экономии ресурсов)
        if (departmentFilter) {
          const filterMap = {
            'OP': 'ОП',
            'Recepcia': 'Рецепция',
            'Kommun': 'Коммун'
          };
          const filterName = filterMap[departmentFilter];
          
          // Проверяем соответствие фильтру
          if (filterName) {
            // Если отдел не определен или не соответствует фильтру - пропускаем
            if (!department || !department.includes(filterName)) {
              return null; // Пропускаем эту очередь
            }
          }
        }

        // Проверяем перезвоны для пропущенных звонков (как в основном отчете)
        // Это необходимо для правильного расчета статистики "Не обработан"
        const abandonedCalls = [];
        calls.forEach((call, i) => {
          const isAbandoned = call.status === 'abandoned' || 
                              (call.duration && parseInt(call.duration) <= 5) ||
                              (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller');
          
          if (isAbandoned) {
            abandonedCalls.push({ index: i, call });
          }
        });
        
        // Проверяем перезвоны только если есть пропущенные звонки
        if (abandonedCalls.length > 0) {
          const callbacks = await checkCallbacksBatch(null, abandonedCalls.map(ac => ac.call), queueName);
          
          // Применяем результаты проверки перезвонов
          // Важно: callbacks - это массив результатов в том же порядке, что и abandonedCalls
          callbacks.forEach((callback, idx) => {
            const { index } = abandonedCalls[idx];
            // callback всегда является объектом с полями: type, status, callbackTime, recordingFile
            // Если статус не 'Не обработан', значит найден перезвон
            if (callback && callback.status && (callback.status === 'Перезвонил сам' || callback.status === 'Перезвонили мы')) {
              calls[index].callback = callback;
              calls[index].callbackStatus = callback.status;
              if (callback.recordingFile) {
                calls[index].recordingFile = callback.recordingFile;
              }
            } else {
              // Если перезвона нет или статус 'Не обработан'
              calls[index].callbackStatus = 'Не обработан';
            }
          });
        }

        // Рассчитываем статистику (теперь с учетом перезвонов)
        const stats = calculateStatsSimple(calls, 'queue');

        // Отладочный вывод для проверки правильности расчета
        const abandonedWithStatus = calls.filter(c => {
          const isAbandoned = c.status === 'abandoned' || 
                              (c.duration && parseInt(c.duration) <= 5) ||
                              (!c.connectTime && c.endTime && c.status !== 'completed_by_agent' && c.status !== 'completed_by_caller');
          return isAbandoned;
        });
        const withCallbackSelf = abandonedWithStatus.filter(c => c.callbackStatus === 'Перезвонил сам').length;
        const withCallbackAgent = abandonedWithStatus.filter(c => c.callbackStatus === 'Перезвонили мы').length;
        const withoutCallback = abandonedWithStatus.filter(c => !c.callbackStatus || c.callbackStatus === 'Не обработан').length;
        
        console.log(`[getQueueRankings] Очередь ${queueName}: ${stats.totalCalls} звонков, пропущено: ${stats.abandonedCalls}, с перезвоном клиент: ${withCallbackSelf}, с перезвоном агент: ${withCallbackAgent}, без перезвона: ${withoutCallback}, статистика: clientCallbacks=${stats.clientCallbacks}, agentCallbacks=${stats.agentCallbacks}, noCallbacks=${stats.noCallbacks}, score: ${calculateCompositeScore(stats).toFixed(1)}, отдел: ${department || 'не указан'}`);

        // Рассчитываем процент необработанных звонков для отображения
        const noCallbacksRate = stats.totalCalls > 0
          ? (stats.noCallbacks / stats.totalCalls) * 100
          : 0;

        return {
          queueName,
          queueDisplayName: formatQueueName(queueName), // Форматированное название с описанием
          department: department || 'Не указан',
          ...stats,
          noCallbacksRate: noCallbacksRate, // Добавляем процент необработанных для отображения
          // Дополнительные метрики для рейтинга
          compositeScore: calculateCompositeScore(stats)
        };
      } catch (error) {
        console.error(`Ошибка при обработке очереди ${queueName}:`, error.message);
        return null;
      }
    });

    // Ждем завершения всех расчетов
    const allResults = await Promise.all(rankingsPromises);
    console.log(`[getQueueRankings] Обработано результатов: ${allResults.length}, не null: ${allResults.filter(r => r !== null).length}`);
    
    const rankings = allResults
      .filter(r => r !== null && r.totalCalls > 0);

    console.log(`[getQueueRankings] Финальный рейтинг: ${rankings.length} очередей`);

    // Сортируем по выбранному критерию
    rankings.sort((a, b) => {
      switch (sortBy) {
        case 'answerRate':
          return b.answerRate - a.answerRate;
        case 'sla':
          return b.slaRate - a.slaRate;
        case 'volume':
          return b.totalCalls - a.totalCalls;
        case 'abandonRate':
          return a.abandonRate - b.abandonRate; // Меньше = лучше
        case 'asa':
          return a.asa - b.asa; // Меньше = лучше
        case 'composite':
        default:
          return b.compositeScore - a.compositeScore;
      }
    });

    // Добавляем позиции в рейтинге
    rankings.forEach((queue, index) => {
      queue.rank = index + 1;
    });

    return rankings;
  } catch (error) {
    console.error('Ошибка при расчете рейтинга очередей:', error);
    throw error;
  }
}

/**
 * Расчет комплексного рейтинга (комбинация нескольких метрик)
 * @param {Object} stats - Статистика очереди
 * @returns {number} Комплексная оценка
 */
function calculateCompositeScore(stats) {
  if (stats.totalCalls === 0) return 0;

  // Веса для разных метрик
  const weights = {
    answerRate: 0.30,      // 30% - процент ответа
    slaRate: 0.25,         // 25% - SLA
    noCallbacksRate: -0.20, // -20% - процент необработанных (упущенных клиентов) - чем меньше, тем лучше
    callbackRate: 0.10     // 10% - процент перезвонов
  };

  // Рассчитываем процент необработанных звонков (упущенных клиентов)
  // Это более важная метрика, чем просто процент пропущенных, так как показывает
  // реальную потерю клиентов, а не те звонки, по которым был перезвон
  const noCallbacksRate = stats.totalCalls > 0
    ? (stats.noCallbacks / stats.totalCalls) * 100
    : 0;

  // Базовые метрики качества
  const qualityScore = 
    (stats.answerRate * weights.answerRate) +
    (stats.slaRate * weights.slaRate) +
    ((100 - noCallbacksRate) * weights.noCallbacksRate) + // Инвертируем noCallbacksRate (чем меньше необработанных, тем лучше)
    (stats.abandonedCalls > 0
      ? ((stats.clientCallbacks + stats.agentCallbacks) / stats.abandonedCalls) * 100 * weights.callbackRate
      : 100 * weights.callbackRate);

  // Бонус за количество звонков: чем больше звонков, тем выше рейтинг
  // Это учитывает сложность обработки большего количества звонков
  // При большом объеме (например, 189 vs 15) разница должна быть очень значительной
  
  // Используем квадратный корень с большим множителем для более существенного влияния объема
  // Формула: sqrt(количество) * множитель дает сильный рост при больших объемах
  const volumeBonus = Math.sqrt(stats.totalCalls) * 4.0;
  
  // Примеры расчета:
  // 15 звонков: sqrt(15) * 4.0 = 3.87 * 4.0 = 15.5 балла
  // 56 звонков: sqrt(56) * 4.0 = 7.48 * 4.0 = 29.9 балла
  // 189 звонков: sqrt(189) * 4.0 = 13.75 * 4.0 = 55.0 балла
  
  // Разница между 15 и 189 звонками: 55.0 - 15.5 = 39.5 балла!
  // Это очень существенная разница, которая значительно компенсирует разницу в качестве
  
  // Ограничиваем максимальный бонус, но делаем его достаточно большим
  // Максимум 60 баллов для очень больших объемов (500+ звонков)
  const maxVolumeBonus = 60.0;
  const clampedBonus = Math.min(volumeBonus, maxVolumeBonus);

  // Финальный рейтинг = качество + бонус за объем
  // Теперь при значительной разнице в объеме очередь с большим количеством звонков
  // получит более высокий рейтинг даже при немного меньшем проценте качества
  const score = qualityScore + clampedBonus;

  return Math.max(0, Math.min(100, score)); // Ограничиваем 0-100
}

/**
 * Получить топ N очередей по критерию
 * @param {string} startTime - Начало периода
 * @param {string} endTime - Конец периода
 * @param {string} sortBy - Критерий сортировки
 * @param {number} limit - Количество в топе
 * @returns {Promise<Array>} Топ очередей
 */
async function getTopQueues(startTime, endTime, sortBy = 'composite', limit = 10) {
  const rankings = await getQueueRankings(startTime, endTime, sortBy);
  return rankings.slice(0, limit);
}

module.exports = {
  getQueueRankings,
  getTopQueues,
  calculateCompositeScore
};

