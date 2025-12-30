/**
 * Адаптер для TypeORM
 * Примечание: TypeORM обычно используется с TypeScript, но может работать и с JavaScript
 */

const { createConnection } = require('typeorm');
const BaseAdapter = require('./base-adapter');

class TypeORMAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    
    // TypeORM 0.2.x использует createConnection вместо DataSource
    this.connection = null;
    
    // Асинхронная инициализация соединения
    this.connectionPromise = createConnection({
      type: 'mysql',
      host: config.host || process.env.DB_HOST || 'localhost',
      username: config.user || process.env.DB_USER || 'freepbxuser',
      password: config.password || process.env.DB_PASS || '',
      database: config.database || process.env.DB_NAME || 'asterisk',
      synchronize: false,
      logging: process.env.DEBUG_DB === 'true',
      extra: {
        connectionLimit: config.connectionLimit || parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
        acquireTimeout: 60000
      },
      entities: []
    }).then(connection => {
      this.connection = connection;
      return connection;
    }).catch(err => {
      console.error('Ошибка инициализации TypeORM:', err);
      throw err;
    });
  }
  
  async ensureConnection() {
    if (this.connection) {
      return this.connection;
    }
    return await this.connectionPromise;
  }

  async execute(sql, params = []) {
    const startTime = Date.now();
    
    try {
      const connection = await this.ensureConnection();
      // TypeORM 0.2.x использует query() с параметрами
      const results = await connection.query(sql, params);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB TypeORM] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return [results, []];
    } catch (error) {
      console.error('[DB Error TypeORM]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async query(sql) {
    const startTime = Date.now();
    
    try {
      const connection = await this.ensureConnection();
      const results = await connection.query(sql);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Query TypeORM] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return [results, []];
    } catch (error) {
      console.error('[DB Query Error TypeORM]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async beginTransaction() {
    const connection = await this.ensureConnection();
    const queryRunner = connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    return queryRunner;
  }

  async executeInTransaction(queryRunner, sql, params = []) {
    const results = await queryRunner.query(sql, params);
    return [results, []];
  }

  async commit(queryRunner) {
    await queryRunner.commitTransaction();
    await queryRunner.release();
  }

  async rollback(queryRunner) {
    await queryRunner.rollbackTransaction();
    await queryRunner.release();
  }

  async getConnection() {
    return await this.ensureConnection();
  }

  getPoolStats() {
    return {
      totalConnections: 0,
      freeConnections: 0,
      queuedRequests: 0,
      cachedStatements: 0,
      adapter: 'typeorm'
    };
  }

  getPool() {
    return this.connection;
  }

  async close() {
    if (this.connection) {
      await this.connection.close();
    }
  }
}

module.exports = TypeORMAdapter;

