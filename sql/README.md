# SQL Scripts

Скрипты для оптимизации и настройки базы данных.

## Файлы

| Файл | Описание |
|------|----------|
| `create-email-table.sql` | Создание таблицы email_reports |
| `optimize-database-indexes.sql` | Основные индексы для queuelog и cdr |
| `optimize-queue-indexes.sql` | Дополнительные индексы для очередей |
| `mariadb-optimization-simple.sql` | Простая оптимизация MariaDB |
| `mariadb-large-data-optimization.sql` | Оптимизация для больших данных |

## Использование

```bash
# Применить основные индексы
mysql -u root -p < sql/optimize-database-indexes.sql

# Применить оптимизацию для MariaDB
mysql -u root -p < sql/mariadb-optimization-simple.sql
```

## Примечание

Перед применением скриптов на production сервере:
1. Сделайте backup базы данных
2. Проверьте скрипты на тестовом сервере
3. Запускайте в период низкой нагрузки
