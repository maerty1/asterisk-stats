-- ==========================================
-- Настройки MySQL для многопоточности (8 ядер)
-- ==========================================
-- Выполните эти команды с правами root/admin для оптимизации MySQL

-- ==========================================
-- Проверка текущих настроек
-- ==========================================
-- SHOW VARIABLES LIKE 'innodb_thread_concurrency';
-- SHOW VARIABLES LIKE 'innodb_read_io_threads';
-- SHOW VARIABLES LIKE 'innodb_write_io_threads';
-- SHOW VARIABLES LIKE 'thread_cache_size';

-- ==========================================
-- Оптимизация для 8 ядер
-- ==========================================

-- Количество потоков для чтения (по умолчанию 4)
-- Рекомендуется: количество ядер / 2
SET GLOBAL innodb_read_io_threads = 4;

-- Количество потоков для записи (по умолчанию 4)
SET GLOBAL innodb_write_io_threads = 4;

-- Кэш потоков (для повторного использования)
SET GLOBAL thread_cache_size = 16;

-- Максимальное количество соединений
SET GLOBAL max_connections = 200;

-- InnoDB параллелизм (0 = неограничено, рекомендуется для SSD)
SET GLOBAL innodb_thread_concurrency = 0;

-- Размер буфера InnoDB (рекомендуется 70-80% RAM для выделенного сервера)
-- SET GLOBAL innodb_buffer_pool_size = 2G; -- Настройте под вашу систему

-- Количество инстансов буфера (рекомендуется >= 8 для большого буфера)
-- SET GLOBAL innodb_buffer_pool_instances = 8;

-- Размер лога InnoDB (для лучшей записи)
-- SET GLOBAL innodb_log_file_size = 256M;

-- ==========================================
-- Оптимизация запросов
-- ==========================================

-- Увеличить размер сортировки
SET GLOBAL sort_buffer_size = 4194304; -- 4MB

-- Увеличить буфер JOIN
SET GLOBAL join_buffer_size = 4194304; -- 4MB

-- Кэш таблиц
SET GLOBAL table_open_cache = 4000;

-- Кэш определений таблиц
SET GLOBAL table_definition_cache = 2000;

-- ==========================================
-- Query Cache (если используется MySQL < 8.0)
-- ==========================================
-- SET GLOBAL query_cache_type = 1;
-- SET GLOBAL query_cache_size = 67108864; -- 64MB

-- ==========================================
-- Настройки для my.cnf (постоянные)
-- ==========================================
-- Добавьте эти строки в /etc/mysql/mysql.conf.d/mysqld.cnf
-- или /etc/my.cnf в секцию [mysqld]:
--
-- [mysqld]
-- # InnoDB настройки для многопоточности
-- innodb_read_io_threads = 4
-- innodb_write_io_threads = 4
-- innodb_thread_concurrency = 0
-- 
-- # Буферы
-- innodb_buffer_pool_size = 2G
-- innodb_buffer_pool_instances = 8
-- innodb_log_file_size = 256M
--
-- # Потоки и соединения
-- thread_cache_size = 16
-- max_connections = 200
--
-- # Оптимизация запросов
-- sort_buffer_size = 4M
-- join_buffer_size = 4M
-- table_open_cache = 4000
-- table_definition_cache = 2000
--
-- # Для SSD (если используется)
-- innodb_flush_neighbors = 0
-- innodb_io_capacity = 2000
-- innodb_io_capacity_max = 4000

-- ==========================================
-- Проверка использования ядер
-- ==========================================
-- SHOW STATUS LIKE 'Threads%';
-- SHOW PROCESSLIST;
-- SHOW STATUS LIKE 'Innodb_os_log%';
-- SHOW ENGINE INNODB STATUS;

-- ==========================================
-- Мониторинг производительности
-- ==========================================
-- Проверить текущие настройки:
-- SHOW VARIABLES LIKE '%innodb%thread%';
-- SHOW VARIABLES LIKE '%buffer%';
-- SHOW VARIABLES LIKE '%cache%';
--
-- Проверить использование:
-- SHOW STATUS LIKE 'Innodb_buffer_pool%';
-- SHOW STATUS LIKE 'Threads%';

