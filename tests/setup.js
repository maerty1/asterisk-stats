/**
 * Jest Setup File
 * Инициализация тестового окружения
 */

// Устанавливаем тестовые переменные окружения
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';

// Отключаем логирование в тестах (опционально)
process.env.LOG_LEVEL = 'error';

// Мокаем базу данных по умолчанию
process.env.DB_HOST = 'localhost';
process.env.DB_USER = 'test';
process.env.DB_PASS = 'test';
process.env.DB_NAME = 'asteriskcdrdb_test';

// Настройки рабочих часов
process.env.WORK_HOURS_ENABLED = 'false';
process.env.WORK_HOURS_START = '07:00';
process.env.WORK_HOURS_END = '23:59';

// Тестовые настройки
process.env.SLA_THRESHOLD = '20';
process.env.CALLBACK_WINDOW_HOURS = '24';
process.env.OUTBOUND_MIN_LENGTH = '7';

// Увеличиваем таймаут для async операций
jest.setTimeout(10000);

// Глобальные хелперы для тестов
global.testHelpers = {
  /**
   * Создать мок звонка
   * @param {Object} overrides - Переопределения полей
   * @returns {Object} Мок звонка
   */
  createMockCall: (overrides = {}) => ({
    uniqueid: '1234567890.123',
    linkedid: '1234567890.123',
    calldate: '2025-12-15 10:30:00',
    src: '79501234567',
    dst: '1001',
    disposition: 'ANSWERED',
    duration: 120,
    billsec: 100,
    ...overrides
  }),

  /**
   * Создать мок очереди
   * @param {Object} overrides - Переопределения полей
   * @returns {Object} Мок очереди
   */
  createMockQueueCall: (overrides = {}) => ({
    uniqueid: '1234567890.123',
    linkedid: '1234567890.123',
    queuename: 'test_queue',
    startTime: '2025-12-15 10:30:00',
    answerTime: '2025-12-15 10:30:15',
    waitTime: 15,
    agent: 'SIP/1001',
    status: 'ANSWERED',
    callbackStatus: 'processed',
    ...overrides
  }),

  /**
   * Создать мок статистики
   * @param {Object} overrides - Переопределения полей
   * @returns {Object} Мок статистики
   */
  createMockStats: (overrides = {}) => ({
    totalCalls: 100,
    answeredCalls: 85,
    abandonedCalls: 15,
    answerRate: 85,
    sla: 80,
    asa: 12,
    avgDuration: 180,
    abandonRate: 15,
    ...overrides
  })
};

// Примечание: afterAll и другие Jest глобали доступны только в тестовых файлах,
// не в setup.js который выполняется до загрузки Jest окружения
