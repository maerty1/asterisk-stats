/**
 * Jest Configuration
 * @type {import('jest').Config}
 */
module.exports = {
  // Тестовое окружение
  testEnvironment: 'node',
  
  // Паттерны для поиска тестов
  testMatch: [
    '**/tests/**/*.test.js',
    '**/__tests__/**/*.js'
  ],
  
  // Игнорируемые директории
  testPathIgnorePatterns: [
    '/node_modules/',
    '/public/'
  ],
  
  // Покрытие кода
  collectCoverageFrom: [
    '*.js',
    'routes/**/*.js',
    'i18n/**/*.js',
    '!jest.config.js',
    '!eslint.config.js',
    '!public/**',
    '!node_modules/**'
  ],
  
  // Директория для отчетов о покрытии
  coverageDirectory: 'coverage',
  
  // Пороги покрытия (опционально)
  // coverageThreshold: {
  //   global: {
  //     branches: 50,
  //     functions: 50,
  //     lines: 50,
  //     statements: 50
  //   }
  // },
  
  // Таймаут для тестов (мс)
  testTimeout: 10000,
  
  // Verbose вывод
  verbose: true,
  
  // Переменные окружения для тестов
  setupFiles: ['<rootDir>/tests/setup.js'],
  
  // Очистка моков между тестами
  clearMocks: true,
  
  // Форматы отчетов
  reporters: ['default'],
  
  // Максимальное количество воркеров
  maxWorkers: 1
};
