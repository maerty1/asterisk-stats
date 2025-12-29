/**
 * Общий модуль для расчета статистики перезвонов
 * Обеспечивает единую формулу расчета "Не обработан" для аналитики и рейтинга
 */

/**
 * Расчет статистики перезвонов для пропущенных звонков
 * 
 * Формула расчета "Не обработан":
 * noCallbacks = Math.max(0, abandonedCalls - clientCallbacks - agentCallbacks)
 * 
 * Где:
 * - abandonedCalls - все пропущенные звонки (status === 'abandoned' или другие критерии)
 * - clientCallbacks - пропущенные звонки с callbackStatus === 'Перезвонил сам'
 * - agentCallbacks - пропущенные звонки с callbackStatus === 'Перезвонили мы'
 * - noCallbacks - пропущенные звонки БЕЗ перезвона (упущенные клиенты)
 * 
 * @param {Array} calls - Массив звонков с полем callbackStatus
 * @param {Function} isAbandonedCall - Функция для определения, является ли звонок пропущенным
 * @returns {Object} Объект со статистикой перезвонов
 */
function calculateCallbackStats(calls, isAbandonedCall) {
  if (!calls || calls.length === 0) {
    return {
      abandonedCalls: 0,
      clientCallbacks: 0,
      agentCallbacks: 0,
      noCallbacks: 0,
      noCallbacksRate: 0
    };
  }

  let abandonedCalls = 0;
  let clientCallbacks = 0;
  let agentCallbacks = 0;

  // Проходим по всем звонкам и считаем статистику
  calls.forEach(call => {
    const isAbandoned = isAbandonedCall ? isAbandonedCall(call) : 
      (call.status === 'abandoned' || 
       (call.duration && parseInt(call.duration) <= 5) ||
       (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller'));

    if (isAbandoned) {
      abandonedCalls++;
      
      // Проверяем статус перезвона
      // Важно: если callbackStatus не установлен (undefined/null), считаем как "Не обработан"
      if (call.callbackStatus === 'Перезвонил сам') {
        clientCallbacks++;
      } else if (call.callbackStatus === 'Перезвонили мы') {
        agentCallbacks++;
      }
      // Если callbackStatus не установлен или равен 'Не обработан' или другому значению,
      // то этот звонок будет учтен в noCallbacks
    }
  });

  // Формула расчета "Не обработан" (упущенные клиенты)
  // Это пропущенные звонки, по которым НЕ было перезвона
  const noCallbacks = Math.max(0, abandonedCalls - clientCallbacks - agentCallbacks);
  
  // Процент необработанных от общего количества звонков
  const totalCalls = calls.length;
  const noCallbacksRate = totalCalls > 0 
    ? (noCallbacks / totalCalls) * 100
    : 0;

  return {
    abandonedCalls,
    clientCallbacks,
    agentCallbacks,
    noCallbacks,
    noCallbacksRate: Math.round(noCallbacksRate * 10) / 10 // Округляем до 1 знака после запятой
  };
}

module.exports = {
  calculateCallbackStats
};

