/**
 * Простой SQLite модуль для работы с таблицей email_reports
 * Использует MySQL/MariaDB, но с отдельной базой данных
 */

const { execute: dbExecute } = require('./db-optimizer');

// Инициализация таблицы email_reports в отдельной базе данных
async function initDatabase() {
  try {
    // Создаем базу данных, если её нет
    await dbExecute(`CREATE DATABASE IF NOT EXISTS email_reports_db`).catch(() => {
      // База уже существует - это нормально
    });
    
    // Создаем таблицу
    await dbExecute(`
      CREATE TABLE IF NOT EXISTS email_reports_db.email_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        queue_name VARCHAR(64) NOT NULL,
        email VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_queue_email (queue_name, email),
        INDEX idx_queue (queue_name),
        INDEX idx_email (email),
        INDEX idx_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('✅ Таблица email_reports_db.email_reports создана/проверена');
    return Promise.resolve();
  } catch (error) {
    console.error('❌ Ошибка инициализации базы данных email_reports:', error);
    throw error;
  }
}

/**
 * Выполнение SQL запроса
 */
async function execute(sql, params = []) {
  // Заменяем email_reports на email_reports_db.email_reports
  const modifiedSql = sql.replace(/FROM\s+email_reports\b/gi, 'FROM email_reports_db.email_reports')
                         .replace(/INTO\s+email_reports\b/gi, 'INTO email_reports_db.email_reports')
                         .replace(/UPDATE\s+email_reports\b/gi, 'UPDATE email_reports_db.email_reports')
                         .replace(/DELETE\s+FROM\s+email_reports\b/gi, 'DELETE FROM email_reports_db.email_reports');
  
  const [result] = await dbExecute(modifiedSql, params);
  return [result, {}];
}

/**
 * Получить все записи
 */
async function getAll(sql, params = []) {
  const modifiedSql = sql.replace(/FROM\s+email_reports\b/gi, 'FROM email_reports_db.email_reports');
  const [rows] = await dbExecute(modifiedSql, params);
  return rows;
}

/**
 * Получить одну запись
 */
async function getOne(sql, params = []) {
  const modifiedSql = sql.replace(/FROM\s+email_reports\b/gi, 'FROM email_reports_db.email_reports');
  const [rows] = await dbExecute(modifiedSql, params);
  return rows && rows.length > 0 ? rows[0] : null;
}

/**
 * Закрытие соединения (не требуется для MySQL пула)
 */
function close() {
  return Promise.resolve();
}

module.exports = {
  initDatabase,
  execute,
  getAll,
  getOne,
  close
};

