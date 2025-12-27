/**
 * Адаптер для mysql2 (текущий/дефолтный)
 */

const mysql = require('mysql2/promise');
const BaseAdapter = require('./base-adapter');

class Mysql2Adapter extends BaseAdapter {
  constructor(config) {
    super(config);
    
    this.DB_CONFIG = {
      host: config.host || process.env.DB_HOST || 'localhost',
      user: config.user || process.env.DB_USER || 'freepbxuser',
      password: config.password || process.env.DB_PASS || 'XCbMZ1TmmqGS',
      database: config.database || process.env.DB_NAME || 'asterisk',
      connectionLimit: config.connectionLimit || parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
      queueLimit: 0,
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      acquireTimeout: 60000,
      timeout: 60000,
      multipleStatements: false,
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: false,
      typeCast: true,
      reconnect: true,
      maxReconnects: 10,
      reconnectDelay: 2000
    };

    this.pool = mysql.createPool(this.DB_CONFIG);
    this.statementCache = new Map();

    // Обработка ошибок пула
    this.pool.on('error', (err) => {
      console.error('Ошибка пула соединений MySQL:', err);
      if (err.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Переподключение к базе данных...');
      }
    });
  }

  async execute(sql, params = []) {
    const startTime = Date.now();
    
    try {
      const [rows, fields] = await this.pool.execute(sql, params);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB MySQL2] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return [rows, fields];
    } catch (error) {
      console.error('[DB Error MySQL2]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async query(sql) {
    const startTime = Date.now();
    
    try {
      const [rows, fields] = await this.pool.query(sql);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Query MySQL2] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return [rows, fields];
    } catch (error) {
      console.error('[DB Query Error MySQL2]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async beginTransaction() {
    const connection = await this.pool.getConnection();
    await connection.beginTransaction();
    return connection;
  }

  async executeInTransaction(connection, sql, params = []) {
    const [rows, fields] = await connection.execute(sql, params);
    return [rows, fields];
  }

  async commit(connection) {
    await connection.commit();
    connection.release();
  }

  async rollback(connection) {
    await connection.rollback();
    connection.release();
  }

  async getConnection() {
    return await this.pool.getConnection();
  }

  getPoolStats() {
    const poolData = this.pool.pool || {};
    return {
      totalConnections: (poolData._allConnections && poolData._allConnections.length) || 0,
      freeConnections: (poolData._freeConnections && poolData._freeConnections.length) || 0,
      queuedRequests: (poolData._connectionQueue && poolData._connectionQueue.length) || 0,
      cachedStatements: this.statementCache.size,
      adapter: 'mysql2'
    };
  }

  getPool() {
    return this.pool;
  }

  async close() {
    await this.pool.end();
  }
}

module.exports = Mysql2Adapter;

