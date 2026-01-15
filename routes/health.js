/**
 * Health check endpoint для мониторинга состояния приложения
 */

const express = require('express');
const router = express.Router();
const { execute: dbExecute } = require('../db-optimizer');
const logger = require('../logger');

// Время запуска приложения
const startTime = Date.now();

/**
 * Проверка соединения с базой данных
 * @returns {Promise<{connected: boolean, latency: number}>}
 */
async function checkDatabase() {
  const start = Date.now();
  try {
    await dbExecute('SELECT 1 as test');
    return {
      connected: true,
      latency: Date.now() - start
    };
  } catch (error) {
    logger.error('Health check: ошибка БД', error);
    return {
      connected: false,
      latency: Date.now() - start,
      error: error.message
    };
  }
}

/**
 * Получить информацию о памяти
 * @returns {Object}
 */
function getMemoryInfo() {
  const mem = process.memoryUsage();
  return {
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + ' MB',
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + ' MB',
    rss: Math.round(mem.rss / 1024 / 1024) + ' MB',
    external: Math.round(mem.external / 1024 / 1024) + ' MB'
  };
}

/**
 * Форматировать uptime
 * @param {number} seconds
 * @returns {string}
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Полная проверка состояния
 *     description: Возвращает детальную информацию о состоянии приложения, БД и памяти
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Приложение работает нормально
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 *       503:
 *         description: Приложение недоступно (проблема с БД)
 */
router.get('/', async (req, res) => {
  const dbStatus = await checkDatabase();
  const uptime = process.uptime();
  
  const health = {
    status: dbStatus.connected ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: {
      seconds: Math.round(uptime),
      formatted: formatUptime(uptime)
    },
    version: process.env.npm_package_version || '1.1.0',
    node: process.version,
    database: dbStatus,
    memory: getMemoryInfo()
  };
  
  const statusCode = dbStatus.connected ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * @swagger
 * /api/health/live:
 *   get:
 *     summary: Liveness probe
 *     description: Простая проверка что приложение запущено (для Kubernetes)
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Приложение живо
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: alive
 */
router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * @swagger
 * /api/health/ready:
 *   get:
 *     summary: Readiness probe
 *     description: Проверка готовности приложения (включая БД) для Kubernetes
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Приложение готово принимать запросы
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ready
 *       503:
 *         description: Приложение не готово
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: not ready
 *                 reason:
 *                   type: string
 *                   example: database unavailable
 */
router.get('/ready', async (req, res) => {
  const dbStatus = await checkDatabase();
  
  if (dbStatus.connected) {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not ready', reason: 'database unavailable' });
  }
});

module.exports = router;
