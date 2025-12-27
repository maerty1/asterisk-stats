/**
 * Модуль оптимизации работы с БД (аналог PDO в PHP)
 * Теперь использует систему адаптеров для поддержки различных ORM/коннекторов
 */

const { getAdapter } = require('./db-factory');

// Получаем адаптер БД (mysql2 по умолчанию или из DB_ADAPTER)
const adapter = getAdapter();

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
  if (adapter.getPool && adapter.getPool().getConnection) {
    const connection = await adapter.getConnection();
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
  return await adapter.execute(sql, params);
}

/**
 * Выполнить запрос без prepared statement (для динамических запросов)
 * @param {string} sql - SQL запрос
 * @returns {Promise} Результат запроса [rows, fields]
 */
async function query(sql) {
  return await adapter.query(sql);
}

/**
 * Начать транзакцию (для batch операций)
 * @returns {Promise} Connection/Transaction для транзакции
 */
async function beginTransaction() {
  return await adapter.beginTransaction();
}

/**
 * Выполнить запрос в транзакции
 * @param {Object} transaction - Объект транзакции из beginTransaction
 * @param {string} sql - SQL запрос
 * @param {Array} params - Параметры
 * @returns {Promise} Результат запроса [rows, fields]
 */
async function executeInTransaction(transaction, sql, params = []) {
  return await adapter.executeInTransaction(transaction, sql, params);
}

/**
 * Закоммитить транзакцию
 * @param {Object} transaction - Объект транзакции из beginTransaction
 */
async function commit(transaction) {
  return await adapter.commit(transaction);
}

/**
 * Откатить транзакцию
 * @param {Object} transaction - Объект транзакции из beginTransaction
 */
async function rollback(transaction) {
  return await adapter.rollback(transaction);
}

/**
 * Получить статистику пула соединений
 */
function getPoolStats() {
  const stats = adapter.getPoolStats();
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
  return await adapter.getConnection();
}

/**
 * Получить пул/клиент (для обратной совместимости)
 */
function getPool() {
  try {
    return adapter.getPool();
  } catch (error) {
    // Если адаптер не поддерживает getPool(), возвращаем сам адаптер
    return adapter;
  }
}

// Для обратной совместимости экспортируем pool
let poolExport;
try {
  poolExport = adapter.getPool();
} catch (error) {
  poolExport = adapter;
}

module.exports = {
  pool: poolExport, // Для обратной совместимости
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
  // Экспортируем адаптер для расширенных возможностей
  adapter
};
