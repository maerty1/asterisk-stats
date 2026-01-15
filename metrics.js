/**
 * Prometheus метрики для мониторинга приложения
 */

const client = require('prom-client');
const logger = require('./logger');

// Создаем реестр метрик
const register = new client.Registry();

// Добавляем default метрики (CPU, память, event loop и т.д.)
client.collectDefaultMetrics({
  register,
  prefix: 'asterisk_stats_'
});

// === Кастомные метрики ===

// Счетчик HTTP запросов
const httpRequestsTotal = new client.Counter({
  name: 'asterisk_stats_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register]
});

// Гистограмма времени ответа HTTP
const httpRequestDuration = new client.Histogram({
  name: 'asterisk_stats_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
  registers: [register]
});

// Счетчик запросов к БД
const dbQueriesTotal = new client.Counter({
  name: 'asterisk_stats_db_queries_total',
  help: 'Total number of database queries',
  labelNames: ['query_type', 'success'],
  registers: [register]
});

// Гистограмма времени запросов к БД
const dbQueryDuration = new client.Histogram({
  name: 'asterisk_stats_db_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['query_type'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
  registers: [register]
});

// Gauge для активных подключений к БД
const dbActiveConnections = new client.Gauge({
  name: 'asterisk_stats_db_active_connections',
  help: 'Number of active database connections',
  registers: [register]
});

// Gauge для размера пула соединений
const dbPoolSize = new client.Gauge({
  name: 'asterisk_stats_db_pool_size',
  help: 'Database connection pool size',
  registers: [register]
});

// Счетчик обработанных звонков
const callsProcessedTotal = new client.Counter({
  name: 'asterisk_stats_calls_processed_total',
  help: 'Total number of calls processed',
  labelNames: ['type', 'status'],
  registers: [register]
});

// Gauge для количества очередей
const activeQueues = new client.Gauge({
  name: 'asterisk_stats_active_queues',
  help: 'Number of active queues',
  registers: [register]
});

// Счетчик отправленных email
const emailsSentTotal = new client.Counter({
  name: 'asterisk_stats_emails_sent_total',
  help: 'Total number of emails sent',
  labelNames: ['type', 'success'],
  registers: [register]
});

// Гистограмма времени генерации отчетов
const reportGenerationDuration = new client.Histogram({
  name: 'asterisk_stats_report_generation_seconds',
  help: 'Report generation time in seconds',
  labelNames: ['report_type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register]
});

/**
 * Middleware для отслеживания HTTP метрик
 */
function metricsMiddleware(req, res, next) {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const duration = process.hrtime(start);
    const durationSeconds = duration[0] + duration[1] / 1e9;
    
    // Получаем route pattern (заменяем динамические параметры)
    const route = req.route?.path || req.path || 'unknown';
    const normalizedRoute = normalizeRoute(route);
    
    httpRequestsTotal.inc({
      method: req.method,
      route: normalizedRoute,
      status_code: res.statusCode
    });
    
    httpRequestDuration.observe({
      method: req.method,
      route: normalizedRoute,
      status_code: res.statusCode
    }, durationSeconds);
  });
  
  next();
}

/**
 * Нормализовать route для метрик (заменить ID на :id)
 */
function normalizeRoute(route) {
  return route
    .replace(/\/\d+/g, '/:id')      // /users/123 -> /users/:id
    .replace(/\/[a-f0-9-]{36}/g, '/:uuid') // UUID
    .slice(0, 50);                   // Ограничиваем длину
}

/**
 * Записать метрику запроса к БД
 * @param {string} queryType - Тип запроса (select, insert, update, etc)
 * @param {number} duration - Длительность в секундах
 * @param {boolean} success - Успешность запроса
 */
function recordDbQuery(queryType, duration, success = true) {
  dbQueriesTotal.inc({ query_type: queryType, success: success ? 'true' : 'false' });
  dbQueryDuration.observe({ query_type: queryType }, duration);
}

/**
 * Обновить метрики пула соединений
 * @param {Object} poolStats - Статистика пула {active, idle, total}
 */
function updatePoolStats(poolStats) {
  if (poolStats) {
    dbActiveConnections.set(poolStats.active || 0);
    dbPoolSize.set(poolStats.total || 0);
  }
}

/**
 * Записать обработанный звонок
 * @param {string} type - Тип (inbound, outbound, queue)
 * @param {string} status - Статус (answered, abandoned, etc)
 */
function recordCall(type, status) {
  callsProcessedTotal.inc({ type, status });
}

/**
 * Установить количество активных очередей
 * @param {number} count
 */
function setActiveQueues(count) {
  activeQueues.set(count);
}

/**
 * Записать отправку email
 * @param {string} type - Тип (daily, queue, manual)
 * @param {boolean} success
 */
function recordEmailSent(type, success) {
  emailsSentTotal.inc({ type, success: success ? 'true' : 'false' });
}

/**
 * Записать время генерации отчета
 * @param {string} reportType - Тип отчета
 * @param {number} duration - Время в секундах
 */
function recordReportGeneration(reportType, duration) {
  reportGenerationDuration.observe({ report_type: reportType }, duration);
}

/**
 * Express роутер для метрик
 */
const express = require('express');
const router = express.Router();

/**
 * @swagger
 * /api/metrics:
 *   get:
 *     summary: Prometheus метрики
 *     description: Возвращает метрики в формате Prometheus
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Метрики в формате Prometheus text
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 */
router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    logger.error('Ошибка получения метрик:', error);
    res.status(500).end(error.message);
  }
});

module.exports = {
  register,
  metricsMiddleware,
  recordDbQuery,
  updatePoolStats,
  recordCall,
  setActiveQueues,
  recordEmailSent,
  recordReportGeneration,
  metricsRouter: router
};
