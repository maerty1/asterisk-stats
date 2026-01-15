/**
 * API роуты для сравнения периодов
 * @swagger
 * tags:
 *   name: Comparison
 *   description: Сравнение статистики между периодами
 */

const express = require('express');
const router = express.Router();
const logger = require('../logger');
const { 
  COMPARISON_TYPES, 
  getComparisonDates, 
  compareStats, 
  compareHourlyStats 
} = require('../period-comparison');
const { calculateStats } = require('../stats-calculator');

// Импортируем функции получения данных
const {
  getQueueCallsUltraFast,
  getInboundCallsUltraFast,
  getOutboundCallsUltraFast
} = require('../db-optimized-queue');

/**
 * @swagger
 * /api/comparison/dates:
 *   get:
 *     summary: Получить даты для сравнения
 *     tags: [Comparison]
 *     parameters:
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [week_to_week, month_to_month]
 *         required: true
 *       - in: query
 *         name: baseDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Даты для сравнения
 */
router.get('/dates', (req, res) => {
  try {
    const { type, baseDate } = req.query;
    
    if (!type || !Object.values(COMPARISON_TYPES).includes(type)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid comparison type',
        validTypes: Object.values(COMPARISON_TYPES)
      });
    }
    
    const dates = getComparisonDates(type, baseDate ? new Date(baseDate) : new Date());
    
    res.json({
      success: true,
      type,
      dates
    });
  } catch (error) {
    logger.error('Ошибка получения дат сравнения:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/comparison/stats:
 *   post:
 *     summary: Сравнить статистику двух периодов
 *     tags: [Comparison]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - queueName
 *               - viewType
 *             properties:
 *               queueName:
 *                 type: string
 *               viewType:
 *                 type: string
 *                 enum: [queue, inbound, outbound]
 *               comparisonType:
 *                 type: string
 *                 enum: [week_to_week, month_to_month, custom]
 *               currentPeriod:
 *                 type: object
 *                 properties:
 *                   start:
 *                     type: string
 *                     format: date
 *                   end:
 *                     type: string
 *                     format: date
 *               previousPeriod:
 *                 type: object
 *                 properties:
 *                   start:
 *                     type: string
 *                     format: date
 *                   end:
 *                     type: string
 *                     format: date
 *     responses:
 *       200:
 *         description: Сравнительная статистика
 */
router.post('/stats', async (req, res) => {
  try {
    const { 
      queueName, 
      viewType = 'queue',
      comparisonType,
      currentPeriod,
      previousPeriod 
    } = req.body;
    
    let dates;
    
    // Определяем даты для сравнения
    if (comparisonType && comparisonType !== COMPARISON_TYPES.CUSTOM) {
      dates = getComparisonDates(comparisonType);
    } else if (currentPeriod && previousPeriod) {
      dates = {
        current: {
          start: currentPeriod.start,
          end: currentPeriod.end,
          label: 'Текущий период'
        },
        previous: {
          start: previousPeriod.start,
          end: previousPeriod.end,
          label: 'Предыдущий период'
        }
      };
    } else {
      return res.status(400).json({
        success: false,
        error: 'Необходимо указать comparisonType или currentPeriod/previousPeriod'
      });
    }
    
    logger.info(`[Comparison] Сравнение ${viewType} для ${queueName || 'все'}: ${dates.current.start} - ${dates.current.end} vs ${dates.previous.start} - ${dates.previous.end}`);
    
    // Получаем данные за оба периода
    const [currentCalls, previousCalls] = await Promise.all([
      getCallsForPeriod(viewType, queueName, dates.current.start, dates.current.end),
      getCallsForPeriod(viewType, queueName, dates.previous.start, dates.previous.end)
    ]);
    
    // Рассчитываем статистику
    const currentStats = calculateStats(currentCalls);
    const previousStats = calculateStats(previousCalls);
    
    // Сравниваем
    const comparison = compareStats(currentStats, previousStats);
    
    // Почасовая статистика
    const currentHourly = calculateHourlyStats(currentCalls);
    const previousHourly = calculateHourlyStats(previousCalls);
    const hourlyComparison = compareHourlyStats(currentHourly, previousHourly);
    
    res.json({
      success: true,
      periods: dates,
      comparison,
      hourly: hourlyComparison,
      summary: {
        currentTotal: currentCalls.length,
        previousTotal: previousCalls.length,
        currentStats,
        previousStats
      }
    });
    
  } catch (error) {
    logger.error('Ошибка сравнения периодов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Получить звонки за период
 */
async function getCallsForPeriod(viewType, queueName, startDate, endDate) {
  const startTime = `${startDate} 00:00:00`;
  const endTime = `${endDate} 23:59:59`;
  
  switch (viewType) {
    case 'queue':
      return await getQueueCallsUltraFast(queueName, startTime, endTime);
    case 'inbound':
      return await getInboundCallsUltraFast(startTime, endTime);
    case 'outbound':
      return await getOutboundCallsUltraFast(startTime, endTime);
    default:
      return await getQueueCallsUltraFast(queueName, startTime, endTime);
  }
}

/**
 * Рассчитать почасовую статистику
 */
function calculateHourlyStats(calls) {
  const hourlyMap = new Map();
  
  for (let i = 0; i < 24; i++) {
    hourlyMap.set(i, { hour: i, calls: 0, answered: 0 });
  }
  
  calls.forEach(call => {
    const date = new Date(call.startTime || call.calldate);
    const hour = date.getHours();
    
    if (hourlyMap.has(hour)) {
      const stats = hourlyMap.get(hour);
      stats.calls++;
      if (call.status === 'ANSWERED' || call.disposition === 'ANSWERED') {
        stats.answered++;
      }
    }
  });
  
  return Array.from(hourlyMap.values());
}

module.exports = router;
