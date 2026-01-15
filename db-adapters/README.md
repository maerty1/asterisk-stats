# Адаптеры базы данных

Модульная система адаптеров для работы с базой данных.

## Структура

- `base-adapter.js` - Базовый класс для всех адаптеров
- `mysql2-adapter.js` - Реализация адаптера для mysql2 (используется по умолчанию)

## Используемый адаптер

### mysql2 (по умолчанию)

- **Пакет**: `mysql2`
- **Преимущества**: Максимальная производительность, нативный драйвер MySQL
- **Connection pooling**: Встроенная поддержка
- **Prepared statements**: Автоматическое кэширование

## Использование

```javascript
const { execute, getConnection } = require('./db-optimizer');

// Выполнение запроса
const [rows] = await execute('SELECT * FROM table WHERE id = ?', [id]);

// Получение соединения для транзакций
const connection = await getConnection();
```

## Расширение

Для добавления нового адаптера:

1. Создайте файл `new-adapter.js`
2. Наследуйте от `BaseAdapter`
3. Реализуйте методы `execute()` и `getConnection()`
4. Обновите `db-optimizer.js` для поддержки нового адаптера
