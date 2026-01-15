/**
 * Роуты для управления email отчетами
 */

const express = require('express');
const router = express.Router();
const settingsDb = require('../settings-db');
const logger = require('../logger');

/**
 * Получить все email адреса (для всех очередей)
 * GET /api/email-reports
 */
router.get('/', async (req, res) => {
  try {
    const rows = await settingsDb.getAll(`
      SELECT id, queue_name, email, is_active, created_at, updated_at
      FROM email_reports
      ORDER BY queue_name, created_at DESC
    `);
    
    res.json({ success: true, emails: rows });
  } catch (error) {
    logger.error('Ошибка получения email адресов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Получить email адреса для конкретной очереди
 * GET /api/email-reports/:queueName
 */
router.get('/:queueName', async (req, res) => {
  try {
    const { queueName } = req.params;
    const rows = await settingsDb.getAll(`
      SELECT id, queue_name, email, is_active, created_at, updated_at
      FROM email_reports
      WHERE queue_name = ?
      ORDER BY created_at DESC
    `, [queueName]);
    
    res.json({ success: true, emails: rows });
  } catch (error) {
    logger.error('Ошибка получения email адресов:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Добавить email адрес
 * POST /api/email-reports
 */
router.post('/', async (req, res) => {
  try {
    const { queue_name, email } = req.body;
    
    if (!queue_name || !email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Необходимо указать queue_name и email' 
      });
    }
    
    // Проверяем, не существует ли уже такой email для этой очереди
    const existing = await settingsDb.get(`
      SELECT id FROM email_reports 
      WHERE queue_name = ? AND email = ?
    `, [queue_name, email]);
    
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        error: 'Этот email уже добавлен для данной очереди' 
      });
    }
    
    await settingsDb.run(`
      INSERT INTO email_reports (queue_name, email, is_active, created_at, updated_at)
      VALUES (?, ?, 1, datetime('now'), datetime('now'))
    `, [queue_name, email]);
    
    res.json({ success: true, message: 'Email успешно добавлен' });
  } catch (error) {
    logger.error('Ошибка добавления email адреса:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Обновить email адрес
 * PUT /api/email-reports/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, is_active } = req.body;
    
    await settingsDb.run(`
      UPDATE email_reports 
      SET email = COALESCE(?, email),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
      WHERE id = ?
    `, [email, is_active, id]);
    
    res.json({ success: true, message: 'Email успешно обновлен' });
  } catch (error) {
    logger.error('Ошибка обновления email адреса:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Удалить email адрес
 * DELETE /api/email-reports/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    await settingsDb.run(`
      DELETE FROM email_reports WHERE id = ?
    `, [id]);
    
    res.json({ success: true, message: 'Email успешно удален' });
  } catch (error) {
    logger.error('Ошибка удаления email адреса:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
