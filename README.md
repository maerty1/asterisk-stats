# Анализатор очередей Asterisk

![Главный экран приложения](https://raw.githubusercontent.com/maerty1/asterisk-stats/refs/heads/main/screen/screen1.png)
![Экран статистики](https://raw.githubusercontent.com/maerty1/asterisk-stats/refs/heads/main/screen/screen2.png)

## Описание

Это веб-приложение для анализа статистики очередей Asterisk, предоставляющее:
- Детальную информацию о звонках
- Визуализацию ключевых показателей
- Доступ к записям разговоров
- Анализ эффективности работы операторов

## Функциональные возможности

- 📊 Просмотр статистики по очередям
- 📅 Фильтрация по датам
- 🎧 Прослушивание записей разговоров
- 📈 Визуализация данных (графики, диаграммы)
- 🔍 Детализация по каждому звонку

## Технологический стек

- **Backend**: Node.js, Express
- **Frontend**: EJS, Bootstrap 5, Chart.js
- **База данных**: MySQL (Asterisk CDR)
- **Дополнительно**: date-fns для работы с датами

## Установка и запуск

1. Клонируйте репозиторий:
```bash
git clone https://github.com/maerty1/asterisk-stats.git
cd asterisk-stats
```

2. Установите зависимости:
```bash
npm install
```

3. Создайте файл `.env` на основе `.env.example` и настройте подключение к БД:
```env
DB_HOST=localhost
DB_USER=freepbxuser
DB_PASS=ваш_пароль
DB_NAME=asterisk
CDR_DB_NAME=asteriskcdrdb
RECORDINGS_PATH=/var/spool/asterisk/monitor
PORT=3000
```

4. Запустите приложение:
```bash
npm start
```

Приложение будет доступно по адресу: `http://localhost:3000`

## Структура проекта

```
asterisk-stats/
├── app.js            # Основной серверный код
├── views/
│   ├── index.ejs     # Главная страница
│   └── error.ejs     # Страница ошибок
├── public/
│   └── style.css     # Стили приложения
├── .env.example      # Пример файла конфигурации
├── package.json      # Зависимости и скрипты
└── README.md         # Документация
```

## Настройка для Production

1. Установите Nginx или другой reverse proxy
2. Настройте HTTPS с помощью Let's Encrypt
3. Используйте PM2 для управления процессом:
```bash
npm install pm2 -g
pm2 start app.js --name queue-analyzer
pm2 save
pm2 startup
```
