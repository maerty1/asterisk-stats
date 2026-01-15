/**
 * Роуты для рейтинга очередей
 */

const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const { getQueueRankings } = require('../queue-rankings');
const logger = require('../logger');

/**
 * @swagger
 * /rankings:
 *   post:
 *     summary: Получить рейтинг очередей
 *     description: Рассчитывает и возвращает рейтинг всех очередей за указанный период
 *     tags: [Rankings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - start_date
 *               - end_date
 *             properties:
 *               start_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-01-01"
 *               end_date:
 *                 type: string
 *                 format: date
 *                 example: "2026-01-15"
 *               sortBy:
 *                 type: string
 *                 enum: [composite, answerRate, sla, asa, totalCalls]
 *                 default: composite
 *               departmentFilter:
 *                 type: string
 *                 description: Фильтр по отделу
 *     responses:
 *       200:
 *         description: Рейтинг успешно получен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 rankings:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/QueueRanking'
 *                 period:
 *                   type: object
 *                   properties:
 *                     start:
 *                       type: string
 *                     end:
 *                       type: string
 *       400:
 *         description: Неверные параметры запроса
 *       500:
 *         description: Ошибка сервера
 */
router.post('/rankings', async (req, res) => {
  try {
    const start_date = req.body.start_date;
    const end_date = req.body.end_date;
    const sortBy = req.body.sortBy;
    const departmentFilter = req.body.departmentFilter || null;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ 
        success: false, 
        error: 'Необходимо указать start_date и end_date' 
      });
    }
    
    const startTime = `${start_date} 00:00:00`;
    const endTime = `${end_date} 23:59:59`;
    const sortCriteria = sortBy || 'composite';
    
    logger.info(`[Rankings] Запрос рейтинга: ${startTime} - ${endTime}, критерий: ${sortCriteria}, отдел: ${departmentFilter || 'все'}`);
    
    const rankings = await getQueueRankings(startTime, endTime, sortCriteria, departmentFilter);
    
    logger.info(`[Rankings] Найдено очередей: ${rankings.length}`);
    
    res.json({
      success: true,
      rankings,
      period: {
        start: start_date,
        end: end_date
      },
      sortBy: sortCriteria,
      departmentFilter: departmentFilter || null
    });
  } catch (error) {
    logger.error('Ошибка при получении рейтинга:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * @swagger
 * /rankings/export-excel:
 *   post:
 *     summary: Экспорт рейтинга в Excel
 *     description: Генерирует и скачивает Excel файл с рейтингом очередей
 *     tags: [Rankings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - start_date
 *               - end_date
 *             properties:
 *               start_date:
 *                 type: string
 *                 format: date
 *               end_date:
 *                 type: string
 *                 format: date
 *               sortBy:
 *                 type: string
 *               departmentFilter:
 *                 type: string
 *     responses:
 *       200:
 *         description: Excel файл
 *         content:
 *           application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Неверные параметры
 *       500:
 *         description: Ошибка сервера
 */
router.post('/export-rankings-excel', async (req, res) => {
  try {
    const { start_date, end_date, sortBy, departmentFilter } = req.body;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ 
        success: false, 
        error: 'Необходимо указать start_date и end_date' 
      });
    }
    
    const startTime = `${start_date} 00:00:00`;
    const endTime = `${end_date} 23:59:59`;
    const sortCriteria = sortBy || 'composite';
    
    const rankings = await getQueueRankings(startTime, endTime, sortCriteria, departmentFilter || null);
    
    // Подготовка данных для Excel
    const excelData = rankings.map((queue) => ({
      'Ранг': queue.rank,
      'Очередь': queue.queueName,
      'Название': queue.queueDisplayName.replace(/^\d+\s*\(|\)$/g, '').replace(/^\d+\s*/, ''),
      'Отдел': queue.department || 'Не указан',
      'Всего звонков': queue.totalCalls,
      'Отвечено': queue.answeredCalls,
      'Процент ответа (%)': queue.answerRate,
      'SLA (%)': queue.slaRate,
      'Пропущено': queue.abandonedCalls,
      'Процент пропущенных (%)': queue.abandonRate,
      'ASA (сек)': queue.asa,
      'Комплексный рейтинг': queue.compositeScore.toFixed(1),
      'Перезвонил сам': queue.clientCallbacks || 0,
      'Перезвонили мы': queue.agentCallbacks || 0,
      'Не обработан': queue.noCallbacks || 0
    }));
    
    // Создание книги Excel
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(excelData);
    
    // Настройка ширины столбцов
    ws['!cols'] = [
      { wch: 6 },  { wch: 12 }, { wch: 30 }, { wch: 15 }, { wch: 12 },
      { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 20 },
      { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }
    ];
    
    XLSX.utils.book_append_sheet(wb, ws, 'Рейтинг очередей');
    
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const filename = `Рейтинг_очередей_${start_date}_${end_date}.xlsx`;
    const filenameUTF8 = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filenameUTF8}`);
    res.send(buffer);
  } catch (error) {
    logger.error('Ошибка при экспорте рейтинга в Excel:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
