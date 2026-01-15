/**
 * View Routes - страницы приложения
 * @module routes/views
 */

const express = require('express');
const router = express.Router();
const helpers = require('../helpers');

// Эти функции будут инжектированы из app.js
let getFilterParams = null;
let getAvailableQueues = null;

/**
 * Инициализация роутера с зависимостями
 * @param {Object} deps - Зависимости
 * @param {Function} deps.getFilterParams - Функция получения параметров фильтра
 * @param {Function} deps.getAvailableQueues - Функция получения списка очередей
 */
function init(deps) {
  getFilterParams = deps.getFilterParams;
  getAvailableQueues = deps.getAvailableQueues;
}

/**
 * Главная страница - Входящая очередь
 */
router.get('/', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Аналитика звонков',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'queue',
    helpers
  });
});

/**
 * Страница входящих звонков
 */
router.get('/inbound', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Входящие звонки - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'inbound',
    helpers
  });
});

/**
 * Страница исходящих очередей
 */
router.get('/outbound-queue', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Исходящие очереди - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'outbound_queue',
    helpers
  });
});

/**
 * Страница исходящих звонков
 */
router.get('/outbound', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Исходящие звонки - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'outbound',
    helpers
  });
});

/**
 * Страница рейтинга очередей
 */
router.get('/rankings', (req, res) => {
  const params = getFilterParams(req);
  res.render('rankings', { 
    title: 'Рейтинг очередей - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    sortBy: req.query.sortBy || 'composite',
    departmentFilter: req.query.departmentFilter || '',
    helpers
  });
});

/**
 * Тестовая страница
 */
router.get('/test', (req, res) => {
  res.render('index', { 
    title: 'Test Page',
    queues: getAvailableQueues(),
    results: null,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    selectedQueue: '',
    viewType: 'queue',
    helpers
  });
});

/**
 * API: Получить запись звонка по uniqueid
 * @swagger
 * /api/recording/{uniqueid}:
 *   get:
 *     summary: Получить аудиозапись звонка по его идентификатору
 *     tags: [Recordings]
 *     parameters:
 *       - in: path
 *         name: uniqueid
 *         required: true
 *         schema:
 *           type: string
 *         description: Уникальный идентификатор звонка (например 1768478301.261093)
 *     responses:
 *       200:
 *         description: Аудиофайл записи
 *         content:
 *           audio/mpeg:
 *             schema:
 *               type: string
 *               format: binary
 *       404:
 *         description: Запись не найдена
 *       500:
 *         description: Ошибка сервера
 */
router.get('/api/recording/:uniqueid', async (req, res) => {
  const { uniqueid } = req.params;
  const logger = require('../logger');
  const { execute } = require('../db-optimizer');
  const path = require('path');
  const fs = require('fs');
  
  try {
    // Валидация uniqueid (формат: числа.числа)
    if (!uniqueid || !/^\d+\.\d+$/.test(uniqueid)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Неверный формат uniqueid. Ожидается формат: 1768478301.261093' 
      });
    }
    
    // Ищем запись в CDR по uniqueid
    const [results] = await execute(`
      SELECT recordingfile, calldate 
      FROM asteriskcdrdb.cdr 
      WHERE uniqueid = ? AND recordingfile != '' AND recordingfile IS NOT NULL
      LIMIT 1
    `, [uniqueid]);
    
    if (!results || results.length === 0) {
      // Пробуем найти файл напрямую по uniqueid в имени
      const recordingsPath = process.env.RECORDINGS_PATH || '/var/spool/asterisk/monitor';
      
      // Ищем файл рекурсивно по uniqueid
      const findResult = require('child_process').execSync(
        `find ${recordingsPath} -name "*${uniqueid}*" -type f 2>/dev/null | head -1`,
        { encoding: 'utf8' }
      ).trim();
      
      if (findResult) {
        logger.info(`[Recording API] Найден файл по uniqueid: ${findResult}`);
        return res.sendFile(findResult, (err) => {
          if (err) {
            logger.error(`[Recording API] Ошибка отправки файла:`, err);
            res.status(500).json({ success: false, error: 'Ошибка при отправке файла' });
          }
        });
      }
      
      return res.status(404).json({ 
        success: false, 
        error: 'Запись для данного звонка не найдена' 
      });
    }
    
    const { recordingfile, calldate } = results[0];
    
    // Формируем путь к файлу на основе даты
    const callDate = new Date(calldate);
    const year = callDate.getFullYear();
    const month = String(callDate.getMonth() + 1).padStart(2, '0');
    const day = String(callDate.getDate()).padStart(2, '0');
    
    const recordingsPath = process.env.RECORDINGS_PATH || '/var/spool/asterisk/monitor';
    const filePath = path.join(recordingsPath, String(year), month, day, recordingfile);
    
    // Проверяем существование файла
    if (!fs.existsSync(filePath)) {
      logger.warn(`[Recording API] Файл не найден по пути: ${filePath}`);
      return res.status(404).json({ 
        success: false, 
        error: 'Файл записи не найден на сервере',
        path: filePath 
      });
    }
    
    logger.info(`[Recording API] Отдаю запись: ${filePath}`);
    
    // Отправляем файл
    res.sendFile(filePath, (err) => {
      if (err) {
        logger.error(`[Recording API] Ошибка отправки файла:`, err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: 'Ошибка при отправке файла' });
        }
      }
    });
    
  } catch (error) {
    logger.error('[Recording API] Ошибка:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * API: Получить информацию о записи звонка (метаданные без скачивания)
 * @swagger
 * /api/recording/{uniqueid}/info:
 *   get:
 *     summary: Получить информацию о записи звонка
 *     tags: [Recordings]
 *     parameters:
 *       - in: path
 *         name: uniqueid
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Информация о записи
 *       404:
 *         description: Запись не найдена
 */
router.get('/api/recording/:uniqueid/info', async (req, res) => {
  const { uniqueid } = req.params;
  const logger = require('../logger');
  const { execute } = require('../db-optimizer');
  const path = require('path');
  const fs = require('fs');
  
  try {
    if (!uniqueid || !/^\d+\.\d+$/.test(uniqueid)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Неверный формат uniqueid' 
      });
    }
    
    // Ищем запись в CDR
    const [results] = await execute(`
      SELECT uniqueid, calldate, src, dst, duration, billsec, 
             disposition, recordingfile, channel, dstchannel
      FROM asteriskcdrdb.cdr 
      WHERE uniqueid = ?
      LIMIT 1
    `, [uniqueid]);
    
    if (!results || results.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Звонок с таким ID не найден' 
      });
    }
    
    const call = results[0];
    let recordingInfo = null;
    
    if (call.recordingfile) {
      const callDate = new Date(call.calldate);
      const year = callDate.getFullYear();
      const month = String(callDate.getMonth() + 1).padStart(2, '0');
      const day = String(callDate.getDate()).padStart(2, '0');
      
      const recordingsPath = process.env.RECORDINGS_PATH || '/var/spool/asterisk/monitor';
      const filePath = path.join(recordingsPath, String(year), month, day, call.recordingfile);
      
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        recordingInfo = {
          filename: call.recordingfile,
          size: stats.size,
          sizeFormatted: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
          downloadUrl: `/api/recording/${uniqueid}`,
          exists: true
        };
      } else {
        recordingInfo = {
          filename: call.recordingfile,
          exists: false,
          error: 'Файл не найден на сервере'
        };
      }
    }
    
    res.json({
      success: true,
      call: {
        uniqueid: call.uniqueid,
        calldate: call.calldate,
        from: call.src,
        to: call.dst,
        duration: call.duration,
        billsec: call.billsec,
        status: call.disposition,
        channel: call.channel,
        dstchannel: call.dstchannel
      },
      recording: recordingInfo
    });
    
  } catch (error) {
    logger.error('[Recording Info API] Ошибка:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = { router, init };
