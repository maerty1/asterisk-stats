/**
 * SQLite модуль для работы с настройками приложения
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

const DB_PATH = path.join(__dirname, 'settings.db');
let db = null;
let SQLInstance = null;

// Значения по умолчанию для настроек
const DEFAULT_SETTINGS = {
  // Database settings
  DB_HOST: 'localhost',
  DB_USER: 'freepbxuser',
    DB_PASS: '',
  DB_NAME: 'asterisk',
  DB_ADAPTER: 'mysql2',
  DB_CONNECTION_LIMIT: '20',
  
  // SMTP settings
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PORT: '587',
  SMTP_SECURE: 'false',
  SMTP_USER: '',
  SMTP_PASS: '',
  EMAIL_FROM_NAME: 'Asterisk Analytics',
  EMAIL_CRON_SCHEDULE: '59 23 * * *',
  
  // Server settings
  PORT: '3000',
  TZ: 'Europe/Moscow',
  
  // Other settings
  DEBUG: 'false',
  RECORDINGS_PATH: '/var/spool/asterisk/monitor',
  USE_ULTRA_FAST_QUERIES: 'true',
  USE_PARALLEL_QUERIES: 'true',
  USE_LARGE_DATA_OPTIMIZATION: 'false',
  OUTBOUND_MIN_LENGTH: '4',
  QUEUES_CACHE_TTL: '3600000'
};

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
      console.log('✅ База данных настроек загружена:', DB_PATH);
    } else {
      db = new SQLInstance.Database();
      console.log('✅ Создана новая база данных настроек:', DB_PATH);
    }
    
    // Создаем таблицы
    createTables();
    
    // Инициализируем настройки по умолчанию, если база новая
    if (!fs.existsSync(DB_PATH)) {
      initializeDefaultSettings();
    }
    
    // Сохраняем базу данных
    saveDatabase();
    
    console.log('✅ База данных настроек инициализирована');
    return db;
  } catch (err) {
    console.error('Ошибка инициализации базы данных настроек:', err);
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
 * Создание таблиц
 */
function createTables() {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  
  // Таблица настроек
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Таблица email_reports
  db.run(`
    CREATE TABLE IF NOT EXISTS email_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_name TEXT NOT NULL,
      email TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(queue_name, email)
    )
  `);
  
  // Индексы для email_reports
  db.run(`CREATE INDEX IF NOT EXISTS idx_queue ON email_reports(queue_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_email ON email_reports(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_active ON email_reports(is_active)`);
}

/**
 * Инициализация настроек по умолчанию
 */
function initializeDefaultSettings() {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  
  console.log('📝 Инициализация настроек по умолчанию...');
  
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    db.run(`
      INSERT OR IGNORE INTO settings (key, value, description)
      VALUES (?, ?, ?)
    `, [
      key,
      value,
      `Default value for ${key}`
    ]);
  }
  
  saveDatabase();
  console.log('✅ Настройки по умолчанию инициализированы');
}

/**
 * Безопасная обработка параметров для SQL
 */
function escapeValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  // Экранируем строки
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Замена параметров в SQL запросе
 */
function replaceParams(sql, params) {
  let result = sql;
  let paramIndex = 0;
  
  result = result.replace(/\?/g, () => {
    if (paramIndex >= params.length) {
      throw new Error('Недостаточно параметров для SQL запроса');
    }
    const value = params[paramIndex++];
    return escapeValue(value);
  });
  
  return result;
}

/**
 * Получить значение настройки
 */
function getSetting(key, defaultValue = null) {
  if (!db) {
    // Если база не инициализирована, возвращаем из .env или значение по умолчанию
    return process.env[key] || defaultValue || DEFAULT_SETTINGS[key] || null;
  }
  
  try {
    const sql = `SELECT value FROM settings WHERE key = ?`;
    const processedSql = replaceParams(sql, [key]);
    const result = db.exec(processedSql);
    
    if (result.length > 0 && result[0].values.length > 0) {
      return result[0].values[0][0];
    }
    
    // Если настройка не найдена, возвращаем из .env или значение по умолчанию
    return process.env[key] || defaultValue || DEFAULT_SETTINGS[key] || null;
  } catch (err) {
    console.error(`Ошибка получения настройки ${key}:`, err);
    return process.env[key] || defaultValue || DEFAULT_SETTINGS[key] || null;
  }
}

/**
 * Установить значение настройки
 */
function setSetting(key, value, description = null) {
  if (!db) {
    // Если база не инициализирована, просто возвращаем успех (настройки будут сохранены при следующей инициализации)
    return Promise.resolve(true);
  }
  
  try {
    const sql = `
      INSERT OR REPLACE INTO settings (key, value, description, updated_at)
      VALUES (?, ?, ?, datetime('now'))
    `;
    const processedSql = replaceParams(sql, [key, value, description || `Setting for ${key}`]);
    db.run(processedSql);
    saveDatabase();
    return Promise.resolve(true);
  } catch (err) {
    console.error(`Ошибка установки настройки ${key}:`, err);
    return Promise.reject(err);
  }
}

/**
 * Получить все настройки
 */
function getAllSettings() {
  if (!db) {
    // Возвращаем настройки из .env и значения по умолчанию
    const settings = { ...DEFAULT_SETTINGS };
    for (const key in process.env) {
      if (DEFAULT_SETTINGS.hasOwnProperty(key)) {
        settings[key] = process.env[key];
      }
    }
    return settings;
  }
  
  try {
    const sql = `SELECT key, value FROM settings`;
    const result = db.exec(sql);
    const settings = { ...DEFAULT_SETTINGS };
    
    if (result.length > 0) {
      result[0].values.forEach(row => {
        settings[row[0]] = row[1];
      });
    }
    
    // Переопределяем значениями из .env (если есть)
    for (const key in process.env) {
      if (settings.hasOwnProperty(key)) {
        settings[key] = process.env[key];
      }
    }
    
    return settings;
  } catch (err) {
    console.error('Ошибка получения всех настроек:', err);
    return DEFAULT_SETTINGS;
  }
}

// Методы для работы с email_reports (перенесены из sqlite-email-db.js)
function execute(sql, params = []) {
  if (!db) {
    throw new Error('База данных не инициализирована');
  }
  
  const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
  
  try {
    const processedSql = replaceParams(sql, params);
    
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
  getSetting,
  setSetting,
  getAllSettings,
  execute,
  getAll,
  getOne,
  close,
  DB_PATH
};

