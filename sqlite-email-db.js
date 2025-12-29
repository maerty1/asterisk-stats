/**
 * SQLite модуль для работы с таблицей email_reports
 * Использует sql.js (SQLite на JavaScript без нативных зависимостей)
 */

const fs = require('fs');
const path = require('path');

let initSqlJs;
let SQL;

// Ленивая загрузка sql.js
async function loadSqlJs() {
  if (SQL) {
    return SQL;
  }
  
  try {
    initSqlJs = require('sql.js');
    const filebuffer = fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'));
    SQL = await initSqlJs({
      wasmBinary: filebuffer
    });
    return SQL;
  } catch (err) {
    console.error('Ошибка загрузки sql.js:', err);
    throw new Error('Не удалось загрузить sql.js. Попробуйте: npm install sql.js --legacy-peer-deps');
  }
}

const DB_PATH = path.join(__dirname, 'email_reports.db');
let db = null;
let SQLInstance = null;

/**
 * Инициализация SQLite базы данных
 */
async function initDatabase() {
  try {
    SQLInstance = await loadSqlJs();
    
    // Проверяем, существует ли файл БД
    if (fs.existsSync(DB_PATH)) {
      const buffer = fs.readFileSync(DB_PATH);
      db = new SQLInstance.Database(buffer);
      console.log('✅ SQLite база данных загружена:', DB_PATH);
    } else {
      db = new SQLInstance.Database();
      console.log('✅ Создана новая SQLite база данных:', DB_PATH);
    }
    
    // Создаем таблицу
    createTable();
    
    // Сохраняем базу данных
    saveDatabase();
    
    console.log('✅ Таблица email_reports создана/проверена');
    return db;
  } catch (err) {
    console.error('Ошибка инициализации SQLite:', err);
    throw err;
  }
}

/**
 * Сохранение базы данных в файл
 */
function saveDatabase() {
  if (!db) return;
  
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  } catch (err) {
    console.error('Ошибка сохранения базы данных:', err);
  }
}

/**
 * Создание таблицы email_reports
 */
function createTable() {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  
  const sql = `
    CREATE TABLE IF NOT EXISTS email_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_name TEXT NOT NULL,
      email TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(queue_name, email)
    );
    
    CREATE INDEX IF NOT EXISTS idx_queue ON email_reports(queue_name);
    CREATE INDEX IF NOT EXISTS idx_email ON email_reports(email);
    CREATE INDEX IF NOT EXISTS idx_active ON email_reports(is_active);
  `;
  
  db.run(sql);
}

/**
 * Выполнение SQL запроса
 */
function execute(sql, params = []) {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  
  try {
    // Заменяем ? на значения
    let processedSql = sql;
    params.forEach((param, index) => {
      const value = typeof param === 'string' ? `'${param.replace(/'/g, "''")}'` : param;
      processedSql = processedSql.replace('?', value);
    });
    
    if (isSelect) {
      const result = db.exec(processedSql);
      const rows = result.length > 0 ? result[0].values.map(row => {
        const obj = {};
        result[0].columns.forEach((col, idx) => {
          obj[col] = row[idx];
        });
        return obj;
      }) : [];
      return Promise.resolve([rows, {}]);
    } else {
      db.run(processedSql);
      saveDatabase();
      
      // Получаем lastInsertRowid
      const result = db.exec("SELECT last_insert_rowid() as id");
      const insertId = result.length > 0 && result[0].values.length > 0 
        ? result[0].values[0][0] 
        : null;
      
      return Promise.resolve([{ 
        insertId: insertId,
        affectedRows: 1 
      }, {}]);
    }
  } catch (err) {
    console.error('Ошибка выполнения SQL:', err, 'SQL:', sql);
    throw err;
  }
}

/**
 * Получить все записи
 */
function getAll(sql, params = []) {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  
  const processedSql = replaceParams(sql, params);
  const result = db.exec(processedSql);
  const rows = result.length > 0 ? result[0].values.map(row => {
    const obj = {};
    result[0].columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return obj;
  }) : [];
  
  return Promise.resolve(rows);
}

/**
 * Получить одну запись
 */
function getOne(sql, params = []) {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  
  const processedSql = replaceParams(sql, params);
  const result = db.exec(processedSql);
  if (result.length > 0 && result[0].values.length > 0) {
    const row = result[0].values[0];
    const obj = {};
    result[0].columns.forEach((col, idx) => {
      obj[col] = row[idx];
    });
    return Promise.resolve(obj);
  }
  
  return Promise.resolve(null);
}

/**
 * Закрытие соединения
 */
function close() {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
  return Promise.resolve();
}

module.exports = {
  initDatabase,
  execute,
  getAll,
  getOne,
  close,
  DB_PATH
};
