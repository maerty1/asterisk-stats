-- ==========================================
-- Безопасные настройки MariaDB для многопоточности
-- ==========================================
-- Этот скрипт проверяет доступность переменных перед установкой

-- ==========================================
-- Базовые настройки (всегда доступны)
-- ==========================================

-- Кэш потоков
SET GLOBAL thread_cache_size = 16;

-- Максимальное количество соединений
SET GLOBAL max_connections = 200;

-- Размер сортировки
SET GLOBAL sort_buffer_size = 4194304; -- 4MB

-- Буфер JOIN
SET GLOBAL join_buffer_size = 4194304; -- 4MB

-- Кэш таблиц
SET GLOBAL table_open_cache = 4000;

-- Кэш определений таблиц
SET GLOBAL table_definition_cache = 2000;

-- Отключить query cache (лучше для параллелизма)
SET GLOBAL query_cache_type = 0;
SET GLOBAL query_cache_size = 0;

-- ==========================================
-- InnoDB настройки (проверяются перед установкой)
-- ==========================================

-- Попытка установить потоки чтения (если доступно)
SET @var_exists = (SELECT COUNT(*) FROM information_schema.GLOBAL_VARIABLES 
                   WHERE VARIABLE_NAME = 'innodb_read_io_threads');
SET @sql = IF(@var_exists > 0, 
              'SET GLOBAL innodb_read_io_threads = 4', 
              'SELECT "innodb_read_io_threads not available" as message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Попытка установить потоки записи (если доступно)
SET @var_exists = (SELECT COUNT(*) FROM information_schema.GLOBAL_VARIABLES 
                   WHERE VARIABLE_NAME = 'innodb_write_io_threads');
SET @sql = IF(@var_exists > 0, 
              'SET GLOBAL innodb_write_io_threads = 4', 
              'SELECT "innodb_write_io_threads not available" as message');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Оптимизация для SSD
SET GLOBAL innodb_flush_neighbors = 0;
SET GLOBAL innodb_io_capacity = 2000;
SET GLOBAL innodb_io_capacity_max = 4000;

-- ==========================================
-- Простая версия (без проверок)
-- ==========================================
-- Если скрипт выше не работает, используйте эту версию:

-- SET GLOBAL thread_cache_size = 16;
-- SET GLOBAL max_connections = 200;
-- SET GLOBAL sort_buffer_size = 4194304;
-- SET GLOBAL join_buffer_size = 4194304;
-- SET GLOBAL table_open_cache = 4000;
-- SET GLOBAL table_definition_cache = 2000;
-- SET GLOBAL query_cache_type = 0;
-- SET GLOBAL query_cache_size = 0;
-- SET GLOBAL innodb_flush_neighbors = 0;
-- SET GLOBAL innodb_io_capacity = 2000;
-- SET GLOBAL innodb_io_capacity_max = 4000;

