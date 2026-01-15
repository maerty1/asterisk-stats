/**
 * Helper functions for Asterisk queue analysis
 * @module helpers
 */

const { format } = require('date-fns');

/**
 * @typedef {import('./types').QueueCall} QueueCall
 * @typedef {import('./types').CallbackStatus} CallbackStatus
 */

const helpers = {
  /**
   * Перевести статус звонка в читаемый вид с иконкой
   * @param {string} status - Статус звонка
   * @returns {string} HTML строка со статусом
   */
  translateStatus: (status) => {
    const statusMap = {
      'completed_by_caller': '<i class="bi bi-telephone-outbound-fill me-1"></i> Завершен клиентом',
      'completed_by_agent': '<i class="bi bi-telephone-inbound-fill me-1"></i> Завершен агентом',
      'abandoned': '<i class="bi bi-telephone-x-fill me-1"></i> Неотвечен'
    };
    return statusMap[status] || status;
  },

  /**
   * Рассчитать время ожидания звонка в очереди
   * @param {QueueCall} call - Объект звонка
   * @returns {number|string} Время ожидания в секундах или '-'
   */
  calculateWaitTime: (call) => {
    if (!call.startTime) return '-';
    const endTime = call.connectTime || call.endTime;
    if (!endTime) return '-';
    
    try {
      // Парсим строки времени напрямую (формат: "YYYY-MM-DD HH:MM:SS")
      const parseTime = (timeStr) => {
        if (!timeStr || typeof timeStr !== 'string') return null;
        const match = timeStr.match(/(\d{4})-(\d{2})-(\d{2})[\sT](\d{2}):(\d{2}):(\d{2})/);
        if (!match) return null;
        const [, year, month, day, hour, minute, second] = match.map(Number);
        return new Date(year, month - 1, day, hour, minute, second).getTime();
      };
      
      const startTime = parseTime(call.startTime);
      const endTimeParsed = parseTime(endTime);
      
      if (startTime && endTimeParsed && endTimeParsed > startTime) {
        const diffSeconds = Math.round((endTimeParsed - startTime) / 1000);
        // Проверяем разумность значения (не больше 2 часов = 7200 секунд)
        if (diffSeconds >= 0 && diffSeconds <= 7200) {
          return diffSeconds;
        }
      }
    } catch (e) {
      // Игнорируем ошибки парсинга дат
    }
    
    return '-';
  },

  formatDuration: (sec) => {
    if (!sec || isNaN(sec)) return '-';
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins} мин ${secs} сек`;
  },

  formatTime: (timeStr) => {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  },

  formatShortDate: (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit'
    });
  },

  getRecordingLink: (recordingFile) => {
    if (!recordingFile) return null;

    const datePart = recordingFile.split('-')[3];
    if (!datePart || datePart.length !== 8) return null;

    const year = datePart.substring(0, 4);
    const month = datePart.substring(4, 6);
    const day = datePart.substring(6, 8);

    return `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
  }
};

module.exports = helpers;