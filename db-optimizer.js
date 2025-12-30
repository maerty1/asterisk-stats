/**
 * Модуль оптимизации работы с БД (аналог PDO в PHP)
 * Использует mysql2 адаптер (по умолчанию)
 */

const Mysql2Adapter = require('./db-adapters/mysql2-adapter');

// Получаем адаптер БД динамически (будет создан после загрузки настроек)
let adapter = null;

function getDbAdapter() {
  if (!adapter) {
    const config = {
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'freepbxuser',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'asterisk',
      connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20
    };
    adapter = new Mysql2Adapter(config);
  }
  return adapter;
}

// Кэш prepared statements (для совместимости, работает только с mysql2)
const statementCache = new Map();

/**
 * Получить или создать prepared statement (кэширование как в PDO)
 * @param {string} sql - SQL запрос с плейсхолдерами
 * @returns {Promise} Prepared statement
 */
async function getPreparedStatement(sql) {
  // Проверяем кэш
  if (statementCache.has(sql)) {
    return statementCache.get(sql);
  }

  // Для mysql2 создаем через соединение из пула
  const dbAdapter = getDbAdapter();
  if (dbAdapter.getPool && dbAdapter.getPool().getConnection) {
    const connection = await dbAdapter.getConnection();
  try {
      statementCache.set(sql, {
        sql,
        connection: null, // Будем использовать adapter.execute
        lastUsed: Date.now()
      });
      
      return statementCache.get(sql);
    } finally {
      if (connection.release) {
        connection.release();
      }
    }
  } else {
    // Для других адаптеров просто кэшируем SQL
    statementCache.set(sql, {
      sql,
      connection: null,
      lastUsed: Date.now()
    });
    return statementCache.get(sql);
  }
}

/**
 * Выполнить запрос с кэшированием prepared statement (как PDO::prepare + execute)
 * @param {string} sql - SQL запрос
 * @param {Array} params - Параметры для запроса
 * @returns {Promise} Результат запроса [rows, fields]
 */
async function execute(sql, params = []) {
  return await getDbAdapter().execute(sql, params);
}

/**
 * Выполнить запрос без prepared statement (для динамических запросов)
 * @param {string} sql - SQL запрос
 * @returns {Promise} Результат запроса [rows, fields]
 */
async function query(sql) {
  return await getDbAdapter().query(sql);
}

/**
 * Начать транзакцию (для batch операций)
 * @returns {Promise} Connection/Transaction для транзакции
 */
async function beginTransaction() {
  return await getDbAdapter().beginTransaction();
}

/**
 * Выполнить запрос в транзакции
 * @param {Object} transaction - Объект транзакции из beginTransaction
 * @param {string} sql - SQL запрос
 * @param {Array} params - Параметры
 * @returns {Promise} Результат запроса [rows, fields]
 */
async function executeInTransaction(transaction, sql, params = []) {
  return await getDbAdapter().executeInTransaction(transaction, sql, params);
}

/**
 * Закоммитить транзакцию
 * @param {Object} transaction - Объект транзакции из beginTransaction
 */
async function commit(transaction) {
  return await getDbAdapter().commit(transaction);
}

/**
 * Откатить транзакцию
 * @param {Object} transaction - Объект транзакции из beginTransaction
 */
async function rollback(transaction) {
  return await getDbAdapter().rollback(transaction);
}

/**
 * Получить статистику пула соединений
 */
function getPoolStats() {
  const stats = getDbAdapter().getPoolStats();
  stats.cachedStatements = statementCache.size;
  return stats;
}

/**
 * Очистить кэш prepared statements
 */
function clearStatementCache() {
  statementCache.clear();
  console.log('Кэш prepared statements очищен');
}

/**
 * Получить соединение из пула (для сложных операций)
 * ВАЖНО: Для некоторых адаптеров может потребоваться release() после использования!
 */
async function getConnection() {
  return await getDbAdapter().getConnection();
}

/**
 * Получить пул/клиент (для обратной совместимости)
 */
function getPool() {
  try {
    return getDbAdapter().getPool();
  } catch (error) {
    // Если адаптер не поддерживает getPool(), возвращаем сам адаптер
    return getDbAdapter();
  }
}

// Функция для инициализации адаптера после загрузки настроек
function initAdapter(config) {
  // Закрываем старый адаптер, если он есть
  if (adapter && adapter.pool && adapter.pool.end) {
    adapter.pool.end().catch(() => {});
  }
  
  // Создаем новый адаптер с переданной конфигурацией
  adapter = new Mysql2Adapter(config || {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'freepbxuser',
    password: process.env.DB_PASS || '',
    database: process.env.DB_NAME || 'asterisk',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20
  });
  
  // Обновляем poolExport
  try {
    poolExport = adapter.getPool();
  } catch (error) {
    poolExport = adapter;
  }
}

// Для обратной совместимости экспортируем pool (будет создан при инициализации)
let poolExport = null;

module.exports = {
  get pool() {
    // Lazy initialization - создаем pool при первом обращении
    if (!poolExport && adapter) {
      try {
        poolExport = adapter.getPool();
      } catch (error) {
        poolExport = adapter;
      }
    }
    return poolExport;
  },
  execute,
  query,
  beginTransaction,
  executeInTransaction,
  commit,
  rollback,
  getConnection,
  getPoolStats,
  clearStatementCache,
  getPool,
  initAdapter, // Функция для инициализации адаптера после загрузки настроек
  // Экспортируем адаптер для расширенных возможностей (lazy)
  get adapter() {
    return getDbAdapter();
  }
};

