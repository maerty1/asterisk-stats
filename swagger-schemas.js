/**
 * Swagger схемы для моделей данных
 * @swagger
 * components:
 *   schemas:
 *     HealthResponse:
 *       type: object
 *       properties:
 *         status:
 *           type: string
 *           enum: [healthy, unhealthy]
 *           example: healthy
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2026-01-15T12:00:00.000Z"
 *         uptime:
 *           type: object
 *           properties:
 *             seconds:
 *               type: integer
 *               example: 3600
 *             formatted:
 *               type: string
 *               example: "1h 0m 0s"
 *         version:
 *           type: string
 *           example: "1.1.0"
 *         node:
 *           type: string
 *           example: "v16.20.2"
 *         database:
 *           type: object
 *           properties:
 *             connected:
 *               type: boolean
 *             latency:
 *               type: integer
 *               description: Latency in ms
 *         memory:
 *           type: object
 *           properties:
 *             heapUsed:
 *               type: string
 *               example: "35 MB"
 *             heapTotal:
 *               type: string
 *               example: "70 MB"
 *             rss:
 *               type: string
 *               example: "141 MB"
 * 
 *     QueueRanking:
 *       type: object
 *       properties:
 *         rank:
 *           type: integer
 *           example: 1
 *         queueName:
 *           type: string
 *           example: "1001"
 *         queueDisplayName:
 *           type: string
 *           example: "1001 (Продажи)"
 *         department:
 *           type: string
 *           example: "Продажи"
 *         totalCalls:
 *           type: integer
 *           example: 150
 *         answeredCalls:
 *           type: integer
 *           example: 135
 *         abandonedCalls:
 *           type: integer
 *           example: 15
 *         answerRate:
 *           type: number
 *           format: float
 *           example: 90.0
 *         slaRate:
 *           type: number
 *           format: float
 *           example: 85.5
 *         asa:
 *           type: integer
 *           description: Average Speed of Answer (seconds)
 *           example: 12
 *         compositeScore:
 *           type: number
 *           format: float
 *           example: 87.5
 * 
 *     CallStats:
 *       type: object
 *       properties:
 *         totalCalls:
 *           type: integer
 *           example: 500
 *         answeredCalls:
 *           type: integer
 *           example: 450
 *         abandonedCalls:
 *           type: integer
 *           example: 50
 *         answerRate:
 *           type: number
 *           format: float
 *           example: 90.0
 *         avgWaitTime:
 *           type: integer
 *           description: Average wait time in seconds
 *           example: 15
 *         avgDuration:
 *           type: integer
 *           description: Average call duration in seconds
 *           example: 180
 *         sla:
 *           type: number
 *           format: float
 *           example: 85.0
 *         peakHour:
 *           type: string
 *           example: "10:00-11:00"
 * 
 *     EmailReport:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           example: 1
 *         queue_name:
 *           type: string
 *           example: "1001"
 *         email:
 *           type: string
 *           format: email
 *           example: "user@example.com"
 *         is_active:
 *           type: boolean
 *           example: true
 *         created_at:
 *           type: string
 *           format: date-time
 *         updated_at:
 *           type: string
 *           format: date-time
 * 
 *     Setting:
 *       type: object
 *       additionalProperties:
 *         type: string
 *       example:
 *         DB_HOST: "localhost"
 *         DB_USER: "freepbxuser"
 *         TIMEZONE: "Europe/Moscow"
 * 
 *     Error:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           example: "Описание ошибки"
 * 
 *     Success:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         message:
 *           type: string
 *           example: "Операция выполнена успешно"
 */

// Этот файл только для Swagger схем, экспорт не нужен
module.exports = {};
