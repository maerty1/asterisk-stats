# Настройка переменных окружения (.env)

## Быстрый старт

1. Скопируйте `.env.example` в `.env`:
   ```bash
   cp .env.example .env
   ```

2. Отредактируйте `.env` и заполните реальные значения

## Все доступные настройки

### База данных

```env
DB_HOST=localhost
DB_USER=freepbxuser
DB_PASS=your_password_here
DB_NAME=asterisk
DB_CONNECTION_LIMIT=20
```

### Оптимизация производительности

```env
# Кэширование списка очередей (в миллисекундах)
QUEUES_CACHE_TTL=3600000

# Минимальная длина номера для определения исходящих звонков
OUTBOUND_MIN_LENGTH=4
```

### Параллельные запросы (для многопоточности)

```env
# Включить параллельные запросы (разбиение на чанки)
USE_PARALLEL_QUERIES=true

# Размер временного чанка в часах (для разбиения периодов)
DB_TIME_CHUNK_HOURS=4

# Максимальное количество параллельных запросов (рекомендуется = количество ядер)
DB_MAX_PARALLEL=8

# Размер чанка для batch-запросов (количество элементов)
DB_BATCH_CHUNK_SIZE=50
```

### Оптимизация для больших данных (MariaDB)

```env
# Использовать оптимизированные запросы для больших данных
# (временные таблицы, оптимизация JOIN, EXISTS вместо JOIN)
USE_LARGE_DATA_OPTIMIZATION=false
```

### Отладка

```env
# Включить отладку БД запросов (показывает время выполнения)
DEBUG_DB=false

# Включить общую отладку
DEBUG=false
```

### Email настройки

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password_here
EMAIL_RECIPIENTS=recipient1@example.com,recipient2@example.com
EMAIL_FROM_NAME=Asterisk Analytics
EMAIL_CRON_SCHEDULE=59 23 * * *
TZ=Europe/Moscow
```

### Путь к записям

```env
RECORDINGS_PATH=/var/spool/asterisk/monitor
```

## Рекомендуемые настройки для производительности

### Для сервера с 8 ядрами:

```env
DB_CONNECTION_LIMIT=20
USE_PARALLEL_QUERIES=true
DB_MAX_PARALLEL=8
DB_TIME_CHUNK_HOURS=4
USE_LARGE_DATA_OPTIMIZATION=true
DEBUG_DB=false
```

### Для больших таблиц (>1M записей):

```env
USE_LARGE_DATA_OPTIMIZATION=true
DB_TIME_CHUNK_HOURS=2
DB_BATCH_CHUNK_SIZE=30
```

### Для тестирования/отладки:

```env
DEBUG_DB=true
DEBUG=true
USE_PARALLEL_QUERIES=false
USE_LARGE_DATA_OPTIMIZATION=false
```

## Примечания

- `USE_PARALLEL_QUERIES=true` - разбивает запросы на чанки и выполняет параллельно (использует больше ядер)
- `USE_LARGE_DATA_OPTIMIZATION=true` - использует временные таблицы и EXISTS вместо JOIN (для больших таблиц)
- Можно использовать оба флага одновременно для максимальной производительности
- `DEBUG_DB=true` - показывает время выполнения каждого SQL запроса (полезно для оптимизации)

