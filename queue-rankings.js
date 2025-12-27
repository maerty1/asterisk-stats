/**
 * Модуль для расчета рейтингов очередей
 */

const { execute: dbExecute, pool } = require('./db-optimizer');
const { getQueueCallsUltraFast } = require('./db-optimized-queue');
const { calculateStatsSimple } = require('./queue-rankings-helper');

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

        // Рассчитываем статистику (перезвоны можно добавить позже для ускорения)
        const stats = calculateStatsSimple(calls, 'queue');

        console.log(`[getQueueRankings] Очередь ${queueName}: ${stats.totalCalls} звонков, score: ${calculateCompositeScore(stats).toFixed(1)}, отдел: ${department || 'не указан'}`);

        return {
          queueName,
          queueDisplayName: formatQueueName(queueName), // Форматированное название с описанием
          department: department || 'Не указан',
          ...stats,
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
    volume: 0.15,          // 15% - объем звонков (нормализовано)
    abandonRate: -0.20,    // -20% - чем меньше, тем лучше (отрицательный вес)
    callbackRate: 0.10     // 10% - процент перезвонов
  };

  // Нормализация объема звонков (предполагаем макс 1000 звонков за период)
  const normalizedVolume = Math.min(stats.totalCalls / 1000, 1) * 100;

  // Процент перезвонов (обработанных из пропущенных)
  const callbackRate = stats.abandonedCalls > 0
    ? ((stats.clientCallbacks + stats.agentCallbacks) / stats.abandonedCalls) * 100
    : 100;

  // Расчет комплексной оценки (0-100)
  const score = 
    (stats.answerRate * weights.answerRate) +
    (stats.slaRate * weights.slaRate) +
    (normalizedVolume * weights.volume) +
    ((100 - stats.abandonRate) * weights.abandonRate) + // Инвертируем abandonRate
    (callbackRate * weights.callbackRate);

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

