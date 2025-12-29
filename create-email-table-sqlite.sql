-- Таблица для хранения email адресов и привязки к очередям (SQLite версия)
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

