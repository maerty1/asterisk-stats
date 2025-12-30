/**
 * Адаптер для Objection.js (основан на Knex)
 */

const { Model } = require('objection');
const knex = require('knex');
const BaseAdapter = require('./base-adapter');

class ObjectionAdapter extends BaseAdapter {
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
        acquireTimeoutMillis: 60000
      },
      debug: process.env.DEBUG_DB === 'true'
    };

    this.knex = knex(dbConfig);
    
    // Привязываем Knex к Objection
    Model.knex(this.knex);
  }

  async execute(sql, params = []) {
    const startTime = Date.now();
    
    try {
      const results = await this.knex.raw(sql, params);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Objection] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return Array.isArray(results[0]) ? [results[0], results[1]] : [results[0], []];
    } catch (error) {
      console.error('[DB Error Objection]', error.message);
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
        console.log(`[DB Query Objection] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return Array.isArray(results[0]) ? [results[0], results[1]] : [results[0], []];
    } catch (error) {
      console.error('[DB Query Error Objection]', error.message);
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
    return this.knex;
  }

  getPoolStats() {
    const pool = this.knex.client.pool;
    const numUsed = pool && typeof pool.numUsed === 'function' ? pool.numUsed() : 0;
    const numFree = pool && typeof pool.numFree === 'function' ? pool.numFree() : 0;
    return {
      totalConnections: numUsed || 0,
      freeConnections: numFree || 0,
      queuedRequests: 0,
      cachedStatements: 0,
      adapter: 'objection'
    };
  }

  getPool() {
    return this.knex.client.pool;
  }

  async close() {
    await this.knex.destroy();
  }
}

module.exports = ObjectionAdapter;

