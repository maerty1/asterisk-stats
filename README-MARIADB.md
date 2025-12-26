# Оптимизация MariaDB для многопоточности

## Быстрый старт

```bash
mysql -u root -p < mariadb-optimization-simple.sql
```

## Постоянные настройки

Добавьте в `/etc/mysql/mariadb.conf.d/50-server.cnf`:

```ini
[mariadb]
# Потоки и соединения
thread_cache_size = 16
max_connections = 200

# Оптимизация запросов
sort_buffer_size = 4M
join_buffer_size = 4M
table_open_cache = 4000
table_definition_cache = 2000

# Query cache (отключен для параллелизма)
query_cache_type = 0
query_cache_size = 0

# InnoDB оптимизация
innodb_flush_neighbors = 0
innodb_io_capacity = 2000
innodb_io_capacity_max = 4000

# Буферы (настройте под вашу систему)
# innodb_buffer_pool_size = 2G
# innodb_buffer_pool_instances = 8
```

После изменений:
```bash
systemctl restart mariadb
```

## Проверка

```bash
mysql -u root -p -e "SHOW VARIABLES LIKE 'thread_cache_size';"
mysql -u root -p -e "SHOW VARIABLES LIKE 'innodb_io_capacity';"
```

## Примечание

В MariaDB некоторые переменные могут быть недоступны или называться по-другому.
Используйте `mariadb-optimization-simple.sql` для базовых настроек.
