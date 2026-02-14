/**
 * Общий модуль для работы с часовыми поясами
 * Заменяет дублированную логику getTimezone/getTimezoneOffset из app.js и email-service.js
 * 
 * ВАЖНО: Использует Intl API для корректной обработки DST (перехода на летнее/зимнее время)
 * @module timezone-helper
 */

const { format } = require('date-fns');
const { ru } = require('date-fns/locale');
const logger = require('./logger');

/**
 * Получить часовой пояс из настроек
 * @returns {string} Название часового пояса (например 'Europe/Moscow')
 */
function getTimezone() {
  try {
    const settingsDb = require('./settings-db');
    const settings = settingsDb.getAllSettings();
    return settings.TZ || process.env.TZ || 'Europe/Moscow';
  } catch (err) {
    return process.env.TZ || 'Europe/Moscow';
  }
}

/**
 * Получить смещение часового пояса от UTC в часах для конкретной даты
 * Корректно обрабатывает DST (переход на летнее/зимнее время)
 * 
 * @param {string} timezone - Название часового пояса (например 'Europe/Moscow')
 * @param {Date} [date=new Date()] - Дата, для которой нужно определить смещение
 * @returns {number} Смещение в часах от UTC (например 3 для MSK)
 */
function getTimezoneOffset(timezone, date = new Date()) {
  try {
    // Используем Intl API для корректного определения смещения (включая DST)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset'
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    if (tzPart && tzPart.value) {
      // Формат: "GMT+3", "GMT-5", "GMT+5:30"
      const match = tzPart.value.match(/GMT([+-]?)(\d+)(?::(\d+))?/);
      if (match) {
        const sign = match[1] === '-' ? -1 : 1;
        const hours = parseInt(match[2], 10);
        const minutes = parseInt(match[3] || '0', 10);
        return sign * (hours + minutes / 60);
      }
    }
  } catch (e) {
    // Intl не поддерживает этот timezone — используем fallback
    logger.warn(`[timezone-helper] Intl API не распознал timezone "${timezone}", используем fallback`);
  }
  
  // Fallback: статическая таблица (без DST — только для совсем старых Node.js)
  const fallbackOffsets = {
    'Europe/Moscow': 3, 'Europe/Kiev': 2, 'Europe/Kyiv': 2, 'Europe/Minsk': 3,
    'Asia/Yekaterinburg': 5, 'Asia/Krasnoyarsk': 7, 'Asia/Irkutsk': 8,
    'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10, 'Europe/London': 0,
    'Europe/Paris': 1, 'Europe/Berlin': 1, 'America/New_York': -5,
    'America/Los_Angeles': -8, 'Asia/Tashkent': 5, 'Asia/Almaty': 6
  };
  
  return fallbackOffsets[timezone] || 0;
}

/**
 * Получить текущее время в локальном часовом поясе
 * @param {string} [timezone] - Часовой пояс (если не указан, берется из настроек)
 * @returns {Date} Дата/время в локальном часовом поясе
 */
function getNowLocal(timezone) {
  const tz = timezone || getTimezone();
  const offsetHours = getTimezoneOffset(tz);
  const now = new Date();
  return new Date(now.getTime() + (offsetHours * 60 * 60 * 1000));
}

/**
 * Отформатировать текущее время для отображения
 * @param {string} [timezone] - Часовой пояс
 * @returns {string} Строка формата 'dd.MM.yyyy HH:mm:ss'
 */
function formatNowLocal(timezone) {
  const nowLocal = getNowLocal(timezone);
  return format(nowLocal, 'dd.MM.yyyy HH:mm:ss', { locale: ru });
}

/**
 * Конвертировать границы дня из локального времени в UTC
 * @param {string} dateStr - Дата в формате 'yyyy-MM-dd'
 * @param {string} [timezone] - Часовой пояс
 * @returns {{ startTimeUTC: string, endTimeUTC: string, timezone: string, offsetHours: number }}
 */
function dayBoundsToUTC(dateStr, timezone) {
  const tz = timezone || getTimezone();
  const offsetHours = getTimezoneOffset(tz);
  
  const startOfDayLocal = new Date(dateStr + 'T00:00:00');
  const endOfDayLocal = new Date(dateStr + 'T23:59:59');
  
  const startOfDayUTC = new Date(startOfDayLocal.getTime() - (offsetHours * 60 * 60 * 1000));
  const endOfDayUTC = new Date(endOfDayLocal.getTime() - (offsetHours * 60 * 60 * 1000));
  
  return {
    startTimeUTC: format(startOfDayUTC, 'yyyy-MM-dd HH:mm:ss'),
    endTimeUTC: format(endOfDayUTC, 'yyyy-MM-dd HH:mm:ss'),
    timezone: tz,
    offsetHours
  };
}

module.exports = {
  getTimezone,
  getTimezoneOffset,
  getNowLocal,
  formatNowLocal,
  dayBoundsToUTC
};
