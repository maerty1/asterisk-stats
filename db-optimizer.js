/**
 * Модуль оптимизации работы с БД (аналог PDO в PHP)
 * Кэширует prepared statements для максимальной производительности
 */

const mysql = require('mysql2/promise');

// Кэш prepared statements (как в PDO)
const statementCache = new Map();

// Конфигурация базы данных (оптимизированная для производительности)
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'freepbxuser',
  password: process.env.DB_PASS || 'XCbMZ1TmmqGS',
  database: process.env.DB_NAME || 'asterisk',
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
  queueLimit: 0,
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  // Оптимизации для максимальной производительности (как PDO)
  multipleStatements: false, // Безопасность
  dateStrings: false, // Использовать Date объекты
  supportBigNumbers: true,
  bigNumberStrings: false,
  // Настройки для prepared statements
  typeCast: true, // Автоматическое приведение типов
  // Оптимизация сетевых параметров
  reconnect: true,
  maxReconnects: 10,
  reconnectDelay: 2000
};

// Создаем пул соединений
const pool = mysql.createPool(DB_CONFIG);

// Обработка ошибок пула
pool.on('error', (err) => {
  console.error('Ошибка пула соединений MySQL:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    console.log('Переподключение к базе данных...');
  }
});

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

  // Создаем prepared statement через соединение из пула
  const connection = await pool.getConnection();
  try {
    // В mysql2 prepared statements создаются автоматически при execute
    // Но мы можем кэшировать сам SQL для оптимизации
    statementCache.set(sql, {
      sql,
      connection: null, // Будем использовать pool.execute
      lastUsed: Date.now()
    });
    
    return statementCache.get(sql);
  } finally {
    connection.release();
  }
}

/**
 * Выполнить запрос с кэшированием prepared statement (как PDO::prepare + execute)
 * @param {string} sql - SQL запрос
 * @param {Array} params - Параметры для запроса
 * @returns {Promise} Результат запроса
 */
async function execute(sql, params = []) {
  const startTime = Date.now();
  
  try {
    // pool.execute автоматически использует prepared statements
    // и кэширует их на уровне драйвера
    const [rows, fields] = await pool.execute(sql, params);
    
    if (process.env.DEBUG_DB === 'true') {
      const duration = Date.now() - startTime;
      console.log(`[DB] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
    }
    
    return [rows, fields];
  } catch (error) {
    console.error('[DB Error]', error.message);
    console.error('[SQL]', sql.substring(0, 200));
    throw error;
  }
}

/**
 * Выполнить запрос без prepared statement (для динамических запросов)
 * @param {string} sql - SQL запрос
 * @returns {Promise} Результат запроса
 */
async function query(sql) {
  const startTime = Date.now();
  
  try {
    const [rows, fields] = await pool.query(sql);
    
    if (process.env.DEBUG_DB === 'true') {
      const duration = Date.now() - startTime;
      console.log(`[DB Query] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
    }
    
    return [rows, fields];
  } catch (error) {
    console.error('[DB Query Error]', error.message);
    console.error('[SQL]', sql.substring(0, 200));
    throw error;
  }
}

/**
 * Начать транзакцию (для batch операций)
 * @returns {Promise} Connection для транзакции
 */
async function beginTransaction() {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  return connection;
}

/**
 * Выполнить запрос в транзакции
 * @param {Object} connection - Соединение из beginTransaction
 * @param {string} sql - SQL запрос
 * @param {Array} params - Параметры
 * @returns {Promise} Результат запроса
 */
async function executeInTransaction(connection, sql, params = []) {
  const [rows, fields] = await connection.execute(sql, params);
  return [rows, fields];
}

/**
 * Закоммитить транзакцию
 * @param {Object} connection - Соединение из beginTransaction
 */
async function commit(connection) {
  await connection.commit();
  connection.release();
}

/**
 * Откатить транзакцию
 * @param {Object} connection - Соединение из beginTransaction
 */
async function rollback(connection) {
  await connection.rollback();
  connection.release();
}

/**
 * Получить статистику пула соединений
 */
function getPoolStats() {
  return {
    totalConnections: pool.pool._allConnections?.length || 0,
    freeConnections: pool.pool._freeConnections?.length || 0,
    queuedRequests: pool.pool._connectionQueue?.length || 0,
    cachedStatements: statementCache.size
  };
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
 * ВАЖНО: Не забудьте вызвать connection.release() после использования!
 */
async function getConnection() {
  return await pool.getConnection();
}

module.exports = {
  pool,
  execute,
  query,
  beginTransaction,
  executeInTransaction,
  commit,
  rollback,
  getConnection,
  getPoolStats,
  clearStatementCache
};

