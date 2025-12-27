/**
 * Фабрика для создания адаптеров БД
 * Выбирает нужный коннектор на основе переменной окружения DB_ADAPTER
 */

require('dotenv').config();

// Ленивая загрузка адаптеров (загружаем только нужный)
const ADAPTER_LOADERS = {
  'mysql2': () => require('./db-adapters/mysql2-adapter'),
  'sequelize': () => require('./db-adapters/sequelize-adapter'),
  'knex': () => require('./db-adapters/knex-adapter'),
  'objection': () => require('./db-adapters/objection-adapter'),
  'bookshelf': () => require('./db-adapters/bookshelf-adapter'),
  'typeorm': () => require('./db-adapters/typeorm-adapter'),
  'prisma': () => require('./db-adapters/prisma-adapter')
};

// Конфигурация БД
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'freepbxuser',
  password: process.env.DB_PASS || 'XCbMZ1TmmqGS',
  database: process.env.DB_NAME || 'asterisk',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20
};

let adapterInstance = null;

/**
 * Получить текущий адаптер БД
 * @param {Object} config - Конфигурация (опционально)
 * @returns {BaseAdapter} Экземпляр адаптера
 */
function getAdapter(config = null) {
  if (adapterInstance && !config) {
    return adapterInstance;
  }

  const adapterName = (config && config.adapter ? config.adapter : (process.env.DB_ADAPTER || 'mysql2')).toLowerCase();
  const adapterLoader = ADAPTER_LOADERS[adapterName];

  if (!adapterLoader) {
    console.warn(`⚠️  Неизвестный адаптер "${adapterName}", используем mysql2 по умолчанию`);
    try {
      const Mysql2Adapter = ADAPTER_LOADERS['mysql2']();
      adapterInstance = new Mysql2Adapter(config || DB_CONFIG);
      return adapterInstance;
    } catch (error) {
      console.error('❌ Критическая ошибка: не удалось загрузить mysql2 адаптер:', error.message);
      throw error;
    }
  }

  try {
    const AdapterClass = adapterLoader();
    adapterInstance = new AdapterClass(config || DB_CONFIG);
    console.log(`✅ Используется адаптер БД: ${adapterName}`);
    return adapterInstance;
  } catch (error) {
    console.error(`❌ Ошибка инициализации адаптера ${adapterName}:`, error.message);
    console.log(`⚠️  Откатываемся на mysql2`);
    
    // Откат на mysql2 при ошибке
    try {
      const Mysql2Adapter = ADAPTER_LOADERS['mysql2']();
      adapterInstance = new Mysql2Adapter(config || DB_CONFIG);
      return adapterInstance;
    } catch (fallbackError) {
      console.error('❌ Критическая ошибка: не удалось загрузить mysql2 адаптер:', fallbackError.message);
      throw fallbackError;
    }
  }
}

/**
 * Создать новый экземпляр адаптера (без кэширования)
 * @param {string} adapterName - Имя адаптера
 * @param {Object} config - Конфигурация
 * @returns {BaseAdapter} Экземпляр адаптера
 */
function createAdapter(adapterName, config = null) {
  const adapterLoader = ADAPTER_LOADERS[adapterName.toLowerCase()];

  if (!adapterLoader) {
    throw new Error(`Неизвестный адаптер: ${adapterName}. Доступные: ${Object.keys(ADAPTER_LOADERS).join(', ')}`);
  }

  const AdapterClass = adapterLoader();
  return new AdapterClass(config || DB_CONFIG);
}

/**
 * Получить список доступных адаптеров
 * @returns {Array<string>} Массив имен адаптеров
 */
function getAvailableAdapters() {
  return Object.keys(ADAPTER_LOADERS);
}

/**
 * Сбросить кэшированный экземпляр адаптера
 */
function resetAdapter() {
  if (adapterInstance && typeof adapterInstance.close === 'function') {
    adapterInstance.close().catch(err => {
      console.error('Ошибка при закрытии адаптера:', err);
    });
  }
  adapterInstance = null;
}

// Автоматическая инициализация при загрузке модуля
const adapter = getAdapter();

module.exports = {
  getAdapter,
  createAdapter,
  getAvailableAdapters,
  resetAdapter
};

