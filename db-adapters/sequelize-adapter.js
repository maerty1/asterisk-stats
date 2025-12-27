/**
 * Адаптер для Sequelize ORM
 */

const { Sequelize } = require('sequelize');
const BaseAdapter = require('./base-adapter');

class SequelizeAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    
    const dbConfig = {
      host: config.host || process.env.DB_HOST || 'localhost',
      username: config.user || process.env.DB_USER || 'freepbxuser',
      password: config.password || process.env.DB_PASS || 'XCbMZ1TmmqGS',
      database: config.database || process.env.DB_NAME || 'asterisk',
      dialect: 'mysql',
      pool: {
        max: config.connectionLimit || parseInt(process.env.DB_CONNECTION_LIMIT) || 20,
        min: 0,
        acquire: 60000,
        idle: 10000
      },
      logging: process.env.DEBUG_DB === 'true' ? console.log : false,
      define: {
        timestamps: false,
        freezeTableName: true
      }
    };

    this.sequelize = new Sequelize(
      dbConfig.database,
      dbConfig.username,
      dbConfig.password,
      dbConfig
    );

    // Тестируем соединение
    this.sequelize.authenticate().catch(err => {
      console.error('Ошибка подключения Sequelize:', err);
    });
  }

  async execute(sql, params = []) {
    const startTime = Date.now();
    
    try {
      // Sequelize использует параметризованные запросы через query()
      // ВАЖНО: без указания типа QueryTypes.SELECT может вернуть разные форматы
      const results = await this.sequelize.query(sql, {
        replacements: params,
        type: this.sequelize.QueryTypes.SELECT
      });
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Sequelize] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      // Sequelize QueryTypes.SELECT всегда возвращает массив объектов
      // Но на всякий случай проверяем и нормализуем
      const rowsArray = Array.isArray(results) ? results : (results ? [results] : []);
      
      // Возвращаем в формате [rows, fields] для совместимости
      return [rowsArray, []];
    } catch (error) {
      console.error('[DB Error Sequelize]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async query(sql) {
    const startTime = Date.now();
    
    try {
      const results = await this.sequelize.query(sql, {
        type: this.sequelize.QueryTypes.SELECT
      });
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Query Sequelize] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      // Нормализуем результат
      const rowsArray = Array.isArray(results) ? results : (results ? [results] : []);
      return [rowsArray, []];
    } catch (error) {
      console.error('[DB Query Error Sequelize]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async beginTransaction() {
    return await this.sequelize.transaction();
  }

  async executeInTransaction(transaction, sql, params = []) {
    const [results, metadata] = await this.sequelize.query(sql, {
      replacements: params,
      transaction: transaction,
      type: this.sequelize.QueryTypes.SELECT
    });
    return [results, metadata];
  }

  async commit(transaction) {
    await transaction.commit();
  }

  async rollback(transaction) {
    await transaction.rollback();
  }

  async getConnection() {
    // В Sequelize соединение управляется автоматически через пул
    // Возвращаем сам sequelize для совместимости
    return this.sequelize;
  }

  getPoolStats() {
    const pool = this.sequelize.connectionManager.pool;
    return {
      totalConnections: (pool && pool._allConnections && pool._allConnections.length) || 0,
      freeConnections: (pool && pool._freeConnections && pool._freeConnections.length) || 0,
      queuedRequests: 0, // Sequelize не имеет очереди запросов
      cachedStatements: 0,
      adapter: 'sequelize'
    };
  }

  getPool() {
    return this.sequelize.connectionManager.pool;
  }

  async close() {
    await this.sequelize.close();
  }
}

module.exports = SequelizeAdapter;

