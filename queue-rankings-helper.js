/**
 * Вспомогательные функции для рейтингов (копия логики из app.js)
 */

const { calculateCallbackStats } = require('./stats-calculator');

/**
 * Упрощенная версия calculateStats для рейтингов
 */
function calculateStatsSimple(calls, viewType = 'queue') {
  const totalCalls = calls.length;
  if (totalCalls === 0) {
    return {
      totalCalls: 0,
      answeredCalls: 0,
      abandonedCalls: 0,
      answerRate: 0,
      avgWaitTime: 0,
      slaRate: 0,
      avgQueueTime: 0,
      clientCallbacks: 0,
      agentCallbacks: 0,
      noCallbacks: 0,
      asa: 0,
      abandonRate: 0
    };
  }
  
  let answeredCalls = 0;
  let abandonedCalls = 0;
  const waitTimes = [];
  const answeredWaitTimes = [];
  let slaCalls = 0;
  
  const isAbandonedCall = (call) => {
    return call.status === 'abandoned' || 
           (call.duration && parseInt(call.duration) <= 5) ||
           (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller');
  };
  
  calls.forEach(call => {
    const isAbandoned = isAbandonedCall(call);
    
    if (!isAbandoned) {
      answeredCalls++;
    } else {
      abandonedCalls++;
    }
    
    // Собираем waitTimes
    let waitTime = call.waitTime;
    
    // Если waitTime не задан, вычисляем из startTime и connectTime
    if (!waitTime && call.connectTime && call.startTime) {
      try {
        // Парсим строки времени напрямую (формат: "YYYY-MM-DD HH:MM:SS")
        const parseTime = (timeStr) => {
          if (!timeStr || typeof timeStr !== 'string') return null;
          const match = timeStr.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})/);
          if (!match) return null;
          const [, year, month, day, hour, minute, second] = match.map(Number);
          return new Date(year, month - 1, day, hour, minute, second).getTime();
        };
        
        const startTime = parseTime(call.startTime);
        const connectTime = parseTime(call.connectTime);
        
        if (startTime && connectTime && connectTime > startTime) {
          const diffSeconds = Math.round((connectTime - startTime) / 1000);
          // Проверяем разумность значения (не больше 2 часов = 7200 секунд)
          if (diffSeconds >= 0 && diffSeconds <= 7200) {
            waitTime = diffSeconds;
          }
        }
      } catch (e) {
        // Игнорируем ошибки парсинга дат
      }
    }
    
    // Нормализуем waitTime: убеждаемся, что это число и оно разумное
    if (waitTime !== null && waitTime !== undefined) {
      // Преобразуем в число
      waitTime = typeof waitTime === 'string' ? parseInt(waitTime, 10) : Number(waitTime);
      // Проверяем, что это валидное число и не больше 2 часов
      if (isNaN(waitTime) || waitTime < 0 || waitTime > 7200) {
        waitTime = null;
      }
    }
    
    // Добавляем waitTime в массив только если оно валидно
    if (waitTime !== null && waitTime !== undefined && !isNaN(waitTime) && waitTime >= 0 && waitTime <= 7200) {
      waitTimes.push(waitTime);
      
      if (!isAbandoned) {
        answeredWaitTimes.push(waitTime);
        if (waitTime <= 20) {
          slaCalls++;
        }
      }
    }
  });
  
  const avgWaitTime = waitTimes.length > 0 
    ? Math.round(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
    : 0;
  
  const slaRate = totalCalls > 0 ? Math.round(slaCalls / totalCalls * 100) : 0;
  const avgQueueTime = avgWaitTime;
  
  // Статистика перезвонов - используем общую функцию расчета
  // Формула: noCallbacks = abandonedCalls - clientCallbacks - agentCallbacks
  const callbackStats = calculateCallbackStats(calls, isAbandonedCall);
  const clientCallbacks = callbackStats.clientCallbacks;
  const agentCallbacks = callbackStats.agentCallbacks;
  const noCallbacks = callbackStats.noCallbacks;
  // ASA (Average Speed of Answer) - среднее время ответа только для принятых звонков
  let asa = 0;
  if (answeredWaitTimes.length > 0) {
    const sum = answeredWaitTimes.reduce((a, b) => a + b, 0);
    asa = Math.round(sum / answeredWaitTimes.length);
    // Дополнительная проверка на разумность значения (не больше 2 часов)
    if (asa > 7200 || asa < 0 || isNaN(asa)) {
      asa = 0;
    }
  }
  
  const abandonRate = totalCalls > 0 
    ? Math.round((abandonedCalls / totalCalls) * 100 * 10) / 10
    : 0;
  
  return {
    totalCalls,
    answeredCalls,
    abandonedCalls,
    answerRate: totalCalls > 0 ? Math.round(answeredCalls/totalCalls*100) : 0,
    avgWaitTime,
    slaRate,
    slaCalls,
    avgQueueTime,
    clientCallbacks,
    agentCallbacks,
    noCallbacks,
    asa,
    abandonRate
  };
}

module.exports = {
  calculateStatsSimple
};

