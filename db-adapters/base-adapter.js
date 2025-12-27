/**
 * Базовый адаптер для всех коннекторов БД
 * Определяет интерфейс, который должны реализовывать все адаптеры
 */

class BaseAdapter {
  constructor(config) {
    this.config = config;
  }

  /**
   * Выполнить SQL запрос с параметрами (prepared statement)
   * @param {string} sql - SQL запрос
   * @param {Array} params - Параметры
   * @returns {Promise<Array>} [rows, fields] или [rows] в зависимости от коннектора
   */
  async execute(sql, params = []) {
    throw new Error('execute() должен быть реализован в дочернем классе');
  }

  /**
   * Выполнить SQL запрос без параметров
   * @param {string} sql - SQL запрос
   * @returns {Promise<Array>} [rows, fields] или [rows]
   */
  async query(sql) {
    throw new Error('query() должен быть реализован в дочернем классе');
  }

  /**
   * Начать транзакцию
   * @returns {Promise<Object>} Connection/Transaction объект
   */
  async beginTransaction() {
    throw new Error('beginTransaction() должен быть реализован в дочернем классе');
  }

  /**
   * Выполнить запрос в транзакции
   * @param {Object} transaction - Объект транзакции
   * @param {string} sql - SQL запрос
   * @param {Array} params - Параметры
   * @returns {Promise<Array>} [rows, fields] или [rows]
   */
  async executeInTransaction(transaction, sql, params = []) {
    throw new Error('executeInTransaction() должен быть реализован в дочернем классе');
  }

  /**
   * Закоммитить транзакцию
   * @param {Object} transaction - Объект транзакции
   */
  async commit(transaction) {
    throw new Error('commit() должен быть реализован в дочернем классе');
  }

  /**
   * Откатить транзакцию
   * @param {Object} transaction - Объект транзакции
   */
  async rollback(transaction) {
    throw new Error('rollback() должен быть реализован в дочернем классе');
  }

  /**
   * Получить соединение из пула
   * @returns {Promise<Object>} Connection объект
   */
  async getConnection() {
    throw new Error('getConnection() должен быть реализован в дочернем классе');
  }

  /**
   * Получить статистику пула соединений
   * @returns {Object} Статистика
   */
  getPoolStats() {
    throw new Error('getPoolStats() должен быть реализован в дочернем классе');
  }

  /**
   * Получить исходный пул/клиент (для обратной совместимости)
   * @returns {Object} Pool или клиент
   */
  getPool() {
    throw new Error('getPool() должен быть реализован в дочернем классе');
  }

  /**
   * Закрыть все соединения
   */
  async close() {
    throw new Error('close() должен быть реализован в дочернем классе');
  }
}

module.exports = BaseAdapter;

