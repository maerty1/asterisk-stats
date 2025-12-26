#!/bin/bash
# Скрипт для применения оптимизаций MariaDB

echo "🔧 Применение оптимизаций MariaDB..."
echo ""

# Проверяем доступность переменных
echo "1. Проверка доступных переменных..."
mysql -u root -p -e "SHOW VARIABLES LIKE 'innodb_read_io_threads';" 2>/dev/null | grep -q "innodb_read_io_threads" && echo "   ✅ innodb_read_io_threads доступен" || echo "   ❌ innodb_read_io_threads недоступен"

# Применяем базовые настройки
echo ""
echo "2. Применение базовых настроек..."
mysql -u root -p < mariadb-optimization-simple.sql 2>&1 | grep -v "password" | grep -E "ERROR|SET GLOBAL" || echo "   ✅ Базовые настройки применены"

# Применяем оптимизации для больших данных
echo ""
echo "3. Применение оптимизаций для больших данных..."
mysql -u root -p < mariadb-large-data-optimization.sql 2>&1 | grep -v "password" | grep -E "ERROR|SET GLOBAL" || echo "   ✅ Оптимизации для больших данных применены"

echo ""
echo "✅ Готово!"
echo ""
echo "📊 Проверка текущих настроек:"
mysql -u root -p -e "
SHOW VARIABLES LIKE 'thread_cache_size';
SHOW VARIABLES LIKE 'innodb_read_io_threads';
SHOW VARIABLES LIKE 'innodb_write_io_threads';
SHOW VARIABLES LIKE 'innodb_io_capacity';
SHOW VARIABLES LIKE 'join_buffer_size';
SHOW VARIABLES LIKE 'sort_buffer_size';
" 2>/dev/null | grep -E "Variable_name|Value"
