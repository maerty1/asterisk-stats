-- Таблица для хранения email адресов и привязки к очередям
CREATE TABLE IF NOT EXISTS asteriskcdrdb.email_reports (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
