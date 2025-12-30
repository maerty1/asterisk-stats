/**
 * Адаптер для Knex.js Query Builder
 */

const knex = require('knex');
const BaseAdapter = require('./base-adapter');

class KnexAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    
    const dbConfig = {
      client: 'mysql2',
      connection: {
        host: config.host || process.env.DB_HOST || 'localhost',
        user: config.user || process.env.DB_USER || 'freepbxuser',
        password: config.password || process.env.DB_PASS || '',
        database: config.database || process.env.DB_NAME || 'asterisk'
      },
      pool: {
        min: 2,
        max: config.connectionLimit || parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
        acquireTimeoutMillis: 60000,
        createTimeoutMillis: 30000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
        createRetryIntervalMillis: 2000
      },
      debug: process.env.DEBUG_DB === 'true'
    };

    this.knex = knex(dbConfig);
  }

  async execute(sql, params = []) {
    const startTime = Date.now();
    
    try {
      // Knex использует raw() для выполнения сырого SQL с параметрами
      const results = await this.knex.raw(sql, params);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Knex] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      // Knex возвращает [results, fields] для MySQL
      return Array.isArray(results[0]) ? [results[0], results[1]] : [results[0], []];
    } catch (error) {
      console.error('[DB Error Knex]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async query(sql) {
    const startTime = Date.now();
    
    try {
      const results = await this.knex.raw(sql);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Query Knex] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return Array.isArray(results[0]) ? [results[0], results[1]] : [results[0], []];
    } catch (error) {
      console.error('[DB Query Error Knex]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async beginTransaction() {
    return await this.knex.transaction();
  }

  async executeInTransaction(transaction, sql, params = []) {
    const results = await transaction.raw(sql, params);
    return Array.isArray(results[0]) ? [results[0], results[1]] : [results[0], []];
  }

  async commit(transaction) {
    await transaction.commit();
  }

  async rollback(transaction) {
    await transaction.rollback();
  }

  async getConnection() {
    // Knex автоматически управляет соединениями через пул
    return this.knex;
  }

  getPoolStats() {
    const pool = this.knex.client.pool;
    const numUsed = pool && typeof pool.numUsed === 'function' ? pool.numUsed() : 0;
    const numFree = pool && typeof pool.numFree === 'function' ? pool.numFree() : 0;
    return {
      totalConnections: (pool && pool._allConnections && pool._allConnections.length) || numUsed || 0,
      freeConnections: (pool && pool._freeConnections && pool._freeConnections.length) || numFree || 0,
      queuedRequests: 0,
      cachedStatements: 0,
      adapter: 'knex'
    };
  }

  getPool() {
    return this.knex.client.pool;
  }

  async close() {
    await this.knex.destroy();
  }
}

module.exports = KnexAdapter;

