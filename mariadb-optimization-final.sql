-- ==========================================
-- Финальные настройки MariaDB для многопоточности
-- ==========================================
-- Проверено: все переменные доступны в MariaDB
-- Выполните: mysql -u root -p < mariadb-optimization-final.sql

-- ==========================================
-- Базовые настройки (всегда доступны)
-- ==========================================

-- Кэш потоков (важно для многопоточности)
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
-- InnoDB настройки (проверены - доступны)
-- ==========================================

-- Потоки чтения (уже установлены в 4, но можно проверить)
-- SET GLOBAL innodb_read_io_threads = 4;

-- Потоки записи (уже установлены в 4, но можно проверить)
-- SET GLOBAL innodb_write_io_threads = 4;

-- Оптимизация для SSD/быстрых дисков (уже установлены)
-- SET GLOBAL innodb_flush_neighbors = 0;
-- SET GLOBAL innodb_io_capacity = 2000;
-- SET GLOBAL innodb_io_capacity_max = 4000;

-- ==========================================
-- Оптимизация для больших данных
-- ==========================================

-- Увеличить буферы для JOIN и сортировки
SET GLOBAL join_buffer_size = 8388608; -- 8MB
SET GLOBAL sort_buffer_size = 8388608; -- 8MB

-- Буферы для чтения
SET GLOBAL read_buffer_size = 2097152; -- 2MB
SET GLOBAL read_rnd_buffer_size = 4194304; -- 4MB

-- Временные таблицы
SET GLOBAL tmp_table_size = 67108864; -- 64MB
SET GLOBAL max_heap_table_size = 67108864; -- 64MB

-- Максимальный размер пакета
SET GLOBAL max_allowed_packet = 67108864; -- 64MB

-- ==========================================
-- Проверка установленных значений
-- ==========================================
-- Выполните после применения:
-- SHOW VARIABLES LIKE 'thread_cache_size';
-- SHOW VARIABLES LIKE 'innodb_read_io_threads';
-- SHOW VARIABLES LIKE 'innodb_write_io_threads';
-- SHOW VARIABLES LIKE 'innodb_io_capacity';

