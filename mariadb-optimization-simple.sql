-- ==========================================
-- Простые настройки MariaDB для многопоточности
-- ==========================================
-- Эти настройки работают во всех версиях MariaDB

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

-- Оптимизация InnoDB для SSD/быстрых дисков
-- (Эти настройки уже могут быть установлены, проверьте перед применением)
-- SET GLOBAL innodb_flush_neighbors = 0;
-- SET GLOBAL innodb_io_capacity = 2000;
-- SET GLOBAL innodb_io_capacity_max = 4000;

-- Оптимизация буферов
-- SET GLOBAL innodb_buffer_pool_size = 2147483648; -- 2GB (настройте под вашу систему)
-- SET GLOBAL innodb_buffer_pool_instances = 8;

