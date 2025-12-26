# Read-only переменные MariaDB

## Переменные, требующие перезапуска

Следующие переменные являются read-only и требуют изменения в конфигурационном файле и перезапуска MariaDB:

### InnoDB буферы

```ini
[mariadb]
# Размер буфера InnoDB (70-80% RAM для выделенного сервера)
innodb_buffer_pool_size = 2G

# Количество инстансов буфера (для больших буферов)
innodb_buffer_pool_instances = 8

# Размер лога InnoDB
innodb_log_file_size = 256M

# Размер буфера лога
innodb_log_buffer_size = 16M
```

### Как применить

1. Отредактируйте `/etc/mysql/mariadb.conf.d/50-server.cnf`:
   ```bash
   sudo nano /etc/mysql/mariadb.conf.d/50-server.cnf
   ```

2. Добавьте в секцию `[mariadb]`:
   ```ini
   [mariadb]
   innodb_buffer_pool_size = 2G
   innodb_buffer_pool_instances = 8
   innodb_log_file_size = 256M
   innodb_log_buffer_size = 16M
   ```

3. Перезапустите MariaDB:
   ```bash
   sudo systemctl restart mariadb
   ```

4. Проверьте:
   ```sql
   SHOW VARIABLES LIKE 'innodb_buffer_pool_size';
   SHOW VARIABLES LIKE 'innodb_buffer_pool_instances';
   ```

### Рекомендации

- **innodb_buffer_pool_size**: 70-80% RAM для выделенного сервера
- **innodb_buffer_pool_instances**: 8 для буферов > 1GB
- **innodb_log_file_size**: 256MB-512MB для больших данных
- **innodb_log_buffer_size**: 16MB обычно достаточно

### Важно

⚠️ Изменение `innodb_log_file_size` требует особой осторожности:
1. Сделайте бэкап базы данных
2. Остановите MariaDB
3. Удалите старые log файлы (обычно `ib_logfile0`, `ib_logfile1`)
4. Запустите MariaDB - новые файлы создадутся автоматически

Или используйте `innodb_log_file_size` только при первой настройке.

