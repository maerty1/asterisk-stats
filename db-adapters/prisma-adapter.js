/**
 * Адаптер для Prisma ORM
 * Примечание: Prisma требует schema.prisma файл для работы
 */

const { PrismaClient } = require('@prisma/client');
const BaseAdapter = require('./base-adapter');

class PrismaAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    
    // Prisma использует DATABASE_URL из .env или прямые параметры
    const datasourceUrl = process.env.DATABASE_URL || 
      `mysql://${config.user || process.env.DB_USER || 'freepbxuser'}:${config.password || process.env.DB_PASS || 'XCbMZ1TmmqGS'}@${config.host || process.env.DB_HOST || 'localhost'}/${config.database || process.env.DB_NAME || 'asterisk'}`;
    
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: datasourceUrl
        }
      },
      log: process.env.DEBUG_DB === 'true' ? ['query', 'info', 'warn', 'error'] : ['error']
    });
  }

  async execute(sql, params = []) {
    const startTime = Date.now();
    
    try {
      // Prisma использует $queryRaw для параметризованных запросов
      // Нужно конвертировать параметры в формат Prisma ($1, $2, ...)
      // Но для совместимости с MySQL используем формат с ?
      const formattedSql = this._formatSqlForPrisma(sql, params);
      const results = await this.prisma.$queryRawUnsafe(formattedSql);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Prisma] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return [results, []];
    } catch (error) {
      console.error('[DB Error Prisma]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  async query(sql) {
    const startTime = Date.now();
    
    try {
      const results = await this.prisma.$queryRawUnsafe(sql);
      
      if (process.env.DEBUG_DB === 'true') {
        const duration = Date.now() - startTime;
        console.log(`[DB Query Prisma] ${duration}ms: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
      }
      
      return [results, []];
    } catch (error) {
      console.error('[DB Query Error Prisma]', error.message);
      console.error('[SQL]', sql.substring(0, 200));
      throw error;
    }
  }

  /**
   * Форматирует SQL с параметрами для Prisma
   * Prisma не поддерживает параметризованные запросы напрямую с ?,
   * поэтому используем небезопасный метод с подстановкой (требует осторожности)
   */
  _formatSqlForPrisma(sql, params) {
    // Для безопасности лучше использовать $queryRaw с Prisma.sql,
    // но для совместимости с текущим API используем простую подстановку
    // ВНИМАНИЕ: Это может быть уязвимо к SQL injection, если параметры не валидированы!
    let formattedSql = sql;
    params.forEach((param, index) => {
      // Экранируем строки для безопасности
      const escaped = typeof param === 'string' 
        ? `'${param.replace(/'/g, "''")}'` 
        : param;
      formattedSql = formattedSql.replace('?', escaped);
    });
    return formattedSql;
  }

  async beginTransaction() {
    // Prisma использует $transaction для транзакций
    // Но для совместимости возвращаем объект с prisma клиентом
    return {
      prisma: this.prisma,
      _isTransaction: true
    };
  }

  async executeInTransaction(transaction, sql, params = []) {
    // В Prisma транзакции работают иначе - через callback
    // Для совместимости используем прямой запрос
    const formattedSql = this._formatSqlForPrisma(sql, params);
    const results = await transaction.prisma.$queryRawUnsafe(formattedSql);
    return [results, []];
  }

  async commit(transaction) {
    // В Prisma транзакции коммитятся автоматически при завершении callback
    // Для этого адаптера ничего не делаем
    if (transaction._isTransaction) {
      // Если это настоящая транзакция через $transaction, она закроется автоматически
      return;
    }
  }

  async rollback(transaction) {
    // В Prisma откат происходит автоматически при ошибке в callback
    // Для этого адаптера ничего не делаем
    if (transaction._isTransaction) {
      return;
    }
  }

  async getConnection() {
    return this.prisma;
  }

  getPoolStats() {
    // Prisma не предоставляет прямого доступа к статистике пула
    return {
      totalConnections: 0,
      freeConnections: 0,
      queuedRequests: 0,
      cachedStatements: 0,
      adapter: 'prisma'
    };
  }

  getPool() {
    // Prisma использует connection pool внутри, но не предоставляет прямого доступа
    return this.prisma;
  }

  async close() {
    await this.prisma.$disconnect();
  }
}

module.exports = PrismaAdapter;

