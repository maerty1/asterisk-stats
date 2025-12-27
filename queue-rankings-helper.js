/**
 * Вспомогательные функции для рейтингов (копия логики из app.js)
 */

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
    if (!waitTime && call.connectTime && call.startTime) {
      try {
        const start = new Date(call.startTime);
        const connect = new Date(call.connectTime);
        if (!isNaN(start.getTime()) && !isNaN(connect.getTime()) && connect > start) {
          waitTime = Math.round((connect - start) / 1000);
        }
      } catch (e) {
        // Игнорируем ошибки парсинга дат
      }
    }
    
    // Проверяем, что waitTime - разумное число (не больше часа)
    if (waitTime !== null && waitTime !== undefined && !isNaN(waitTime) && waitTime >= 0 && waitTime < 3600) {
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
  
  // Статистика перезвонов
  let clientCallbacks = 0;
  let agentCallbacks = 0;
  calls.forEach(call => {
    if (isAbandonedCall(call)) {
      if (call.callbackStatus === 'Перезвонил сам') {
        clientCallbacks++;
      } else if (call.callbackStatus === 'Перезвонили мы') {
        agentCallbacks++;
      }
    }
  });
  
  const noCallbacks = Math.max(0, abandonedCalls - clientCallbacks - agentCallbacks);
  const asa = answeredWaitTimes.length > 0
    ? Math.round(answeredWaitTimes.reduce((a, b) => a + b, 0) / answeredWaitTimes.length)
    : avgWaitTime;
  
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

