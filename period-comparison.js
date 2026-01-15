/**
 * Модуль сравнения периодов
 * Позволяет сравнивать статистику между двумя периодами
 * @module period-comparison
 */

/**
 * @typedef {import('./types').ComparisonPeriod} ComparisonPeriod
 * @typedef {import('./types').MetricChange} MetricChange
 * @typedef {import('./types').StatsComparison} StatsComparison
 * @typedef {import('./types').QueueStats} QueueStats
 */

const logger = require('./logger');
const { format, subDays, subWeeks, subMonths, startOfWeek, endOfWeek, startOfMonth, endOfMonth } = require('date-fns');

/**
 * Типы сравнения периодов
 */
const COMPARISON_TYPES = {
  WEEK_TO_WEEK: 'week_to_week',
  MONTH_TO_MONTH: 'month_to_month',
  CUSTOM: 'custom'
};

/**
 * Получить даты для сравнения периодов
 * @param {string} type - Тип сравнения
 * @param {Date} baseDate - Базовая дата (конец текущего периода)
 * @returns {Object} - { current: {start, end}, previous: {start, end} }
 */
function getComparisonDates(type, baseDate = new Date()) {
  const base = new Date(baseDate);
  
  switch (type) {
    case COMPARISON_TYPES.WEEK_TO_WEEK: {
      // Текущая неделя vs предыдущая неделя
      const currentWeekStart = startOfWeek(base, { weekStartsOn: 1 }); // Понедельник
      const currentWeekEnd = endOfWeek(base, { weekStartsOn: 1 });
      const previousWeekStart = subWeeks(currentWeekStart, 1);
      const previousWeekEnd = subWeeks(currentWeekEnd, 1);
      
      return {
        current: {
          start: format(currentWeekStart, 'yyyy-MM-dd'),
          end: format(currentWeekEnd, 'yyyy-MM-dd'),
          label: 'Текущая неделя'
        },
        previous: {
          start: format(previousWeekStart, 'yyyy-MM-dd'),
          end: format(previousWeekEnd, 'yyyy-MM-dd'),
          label: 'Прошлая неделя'
        }
      };
    }
    
    case COMPARISON_TYPES.MONTH_TO_MONTH: {
      // Текущий месяц vs предыдущий месяц
      const currentMonthStart = startOfMonth(base);
      const currentMonthEnd = endOfMonth(base);
      const previousMonthStart = startOfMonth(subMonths(base, 1));
      const previousMonthEnd = endOfMonth(subMonths(base, 1));
      
      return {
        current: {
          start: format(currentMonthStart, 'yyyy-MM-dd'),
          end: format(currentMonthEnd, 'yyyy-MM-dd'),
          label: 'Текущий месяц'
        },
        previous: {
          start: format(previousMonthStart, 'yyyy-MM-dd'),
          end: format(previousMonthEnd, 'yyyy-MM-dd'),
          label: 'Прошлый месяц'
        }
      };
    }
    
    default:
      return null;
  }
}

/**
 * Рассчитать процентное изменение
 * @param {number} current - Текущее значение
 * @param {number} previous - Предыдущее значение
 * @returns {Object} - { value, percent, trend }
 */
function calculateChange(current, previous) {
  if (previous === 0) {
    return {
      value: current,
      percent: current > 0 ? 100 : 0,
      trend: current > 0 ? 'up' : 'neutral'
    };
  }
  
  const diff = current - previous;
  const percent = ((diff / previous) * 100).toFixed(1);
  
  return {
    value: diff,
    percent: parseFloat(percent),
    trend: diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral'
  };
}

/**
 * Сравнить статистику двух периодов
 * @param {Object} currentStats - Статистика текущего периода
 * @param {Object} previousStats - Статистика предыдущего периода
 * @returns {Object} - Сравнительная статистика
 */
function compareStats(currentStats, previousStats) {
  const comparison = {
    totalCalls: {
      current: currentStats.totalCalls || 0,
      previous: previousStats.totalCalls || 0,
      change: calculateChange(currentStats.totalCalls || 0, previousStats.totalCalls || 0)
    },
    answeredCalls: {
      current: currentStats.answeredCalls || 0,
      previous: previousStats.answeredCalls || 0,
      change: calculateChange(currentStats.answeredCalls || 0, previousStats.answeredCalls || 0)
    },
    abandonedCalls: {
      current: currentStats.abandonedCalls || 0,
      previous: previousStats.abandonedCalls || 0,
      change: calculateChange(currentStats.abandonedCalls || 0, previousStats.abandonedCalls || 0),
      invertTrend: true // Меньше = лучше
    },
    answerRate: {
      current: currentStats.answerRate || 0,
      previous: previousStats.answerRate || 0,
      change: calculateChange(currentStats.answerRate || 0, previousStats.answerRate || 0)
    },
    sla: {
      current: currentStats.sla || 0,
      previous: previousStats.sla || 0,
      change: calculateChange(currentStats.sla || 0, previousStats.sla || 0)
    },
    asa: {
      current: currentStats.asa || 0,
      previous: previousStats.asa || 0,
      change: calculateChange(currentStats.asa || 0, previousStats.asa || 0),
      invertTrend: true // Меньше = лучше
    },
    avgDuration: {
      current: currentStats.avgDuration || 0,
      previous: previousStats.avgDuration || 0,
      change: calculateChange(currentStats.avgDuration || 0, previousStats.avgDuration || 0)
    }
  };
  
  // Инвертируем тренд для метрик где меньше = лучше
  Object.keys(comparison).forEach(key => {
    if (comparison[key].invertTrend) {
      if (comparison[key].change.trend === 'up') {
        comparison[key].change.trend = 'down';
        comparison[key].change.isNegative = true;
      } else if (comparison[key].change.trend === 'down') {
        comparison[key].change.trend = 'up';
        comparison[key].change.isPositive = true;
      }
    } else {
      if (comparison[key].change.trend === 'up') {
        comparison[key].change.isPositive = true;
      } else if (comparison[key].change.trend === 'down') {
        comparison[key].change.isNegative = true;
      }
    }
  });
  
  return comparison;
}

/**
 * Сравнить почасовую статистику
 * @param {Array} currentHourly - Почасовая статистика текущего периода
 * @param {Array} previousHourly - Почасовая статистика предыдущего периода
 * @returns {Array} - Сравнительная почасовая статистика
 */
function compareHourlyStats(currentHourly, previousHourly) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  
  return hours.map(hour => {
    const current = currentHourly.find(h => h.hour === hour) || { calls: 0, answered: 0 };
    const previous = previousHourly.find(h => h.hour === hour) || { calls: 0, answered: 0 };
    
    return {
      hour,
      current: {
        calls: current.calls || 0,
        answered: current.answered || 0
      },
      previous: {
        calls: previous.calls || 0,
        answered: previous.answered || 0
      },
      change: calculateChange(current.calls || 0, previous.calls || 0)
    };
  });
}

/**
 * Форматировать изменение для отображения
 * @param {Object} change - Объект изменения
 * @returns {string} - Отформатированная строка
 */
function formatChange(change) {
  const sign = change.percent > 0 ? '+' : '';
  return `${sign}${change.percent}%`;
}

/**
 * Получить CSS класс для тренда
 * @param {Object} change - Объект изменения
 * @returns {string} - CSS класс
 */
function getTrendClass(change) {
  if (change.isPositive) return 'trend-positive';
  if (change.isNegative) return 'trend-negative';
  return 'trend-neutral';
}

/**
 * Получить иконку для тренда
 * @param {Object} change - Объект изменения
 * @returns {string} - Иконка
 */
function getTrendIcon(change) {
  if (change.trend === 'up') return '↑';
  if (change.trend === 'down') return '↓';
  return '→';
}

module.exports = {
  COMPARISON_TYPES,
  getComparisonDates,
  calculateChange,
  compareStats,
  compareHourlyStats,
  formatChange,
  getTrendClass,
  getTrendIcon
};
