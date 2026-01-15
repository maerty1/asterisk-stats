/**
 * Роуты для управления настройками приложения
 */

const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const path = require('path');
const settingsDb = require('../settings-db');
const logger = require('../logger');

/**
 * @swagger
 * /api/settings:
 *   get:
 *     summary: Получить все настройки
 *     description: Возвращает все настройки приложения из SQLite базы
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: Настройки успешно получены
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 settings:
 *                   $ref: '#/components/schemas/Setting'
 *       500:
 *         description: Ошибка сервера
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res) => {
  try {
    const settings = settingsDb.getAllSettings();
    res.json({ success: true, settings });
  } catch (error) {
    logger.error('Ошибка получения настроек:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * @swagger
 * /api/settings:
 *   post:
 *     summary: Сохранить настройки
 *     description: Сохраняет настройки и перезапускает приложение
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               settings:
 *                 type: object
 *                 additionalProperties:
 *                   type: string
 *             example:
 *               settings:
 *                 DB_HOST: "localhost"
 *                 TIMEZONE: "Europe/Moscow"
 *     responses:
 *       200:
 *         description: Настройки сохранены, приложение перезапускается
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                 restarting:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Неверный формат данных
 *       500:
 *         description: Ошибка сервера
 */
router.post('/', async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ 
        success: false, 
        error: 'Неверный формат данных' 
      });
    }
    
    // Сохраняем каждую настройку
    for (const [key, value] of Object.entries(settings)) {
      await settingsDb.setSetting(key, value);
    }
    
    // Отправляем ответ клиенту перед перезапуском
    res.json({ 
      success: true, 
      message: 'Настройки успешно сохранены. Приложение перезапускается...',
      restarting: true
    });
    
    // Перезапускаем приложение через 1 секунду
    setTimeout(() => {
      logger.info('🔄 Перезапуск приложения после изменения настроек...');
      
      exec('systemctl is-active --quiet asterisk-stats.service', (error) => {
        if (error === null) {
          logger.info('✅ Используется systemd служба, перезапускаем через systemctl...');
          exec('systemctl restart asterisk-stats.service', (err) => {
            if (err) {
              logger.error('❌ Ошибка перезапуска через systemctl:', err);
              setTimeout(() => process.exit(0), 1000);
            } else {
              logger.info('✅ Команда перезапуска отправлена в systemd');
              setTimeout(() => process.exit(0), 500);
            }
          });
        } else {
          logger.info('⚠️ Приложение не запущено как служба');
          setTimeout(() => process.exit(0), 1000);
        }
      });
    }, 1000);
    
  } catch (error) {
    logger.error('Ошибка сохранения настроек:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
