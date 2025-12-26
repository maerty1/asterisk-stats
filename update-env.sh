#!/bin/bash
# Скрипт для обновления .env из .env.example

if [ ! -f .env ]; then
    echo "Создаю .env из .env.example..."
    cp .env.example .env
    echo "✅ Файл .env создан"
    echo "⚠️  Не забудьте заполнить реальные значения!"
else
    echo "Файл .env уже существует"
    echo "Проверяю новые настройки..."
    
    # Проверяем наличие новых настроек
    for setting in "USE_PARALLEL_QUERIES" "USE_LARGE_DATA_OPTIMIZATION" "DB_MAX_PARALLEL" "DB_TIME_CHUNK_HOURS" "DB_BATCH_CHUNK_SIZE" "DEBUG_DB"; do
        if ! grep -q "^${setting}=" .env 2>/dev/null; then
            echo "  ➕ Добавляю ${setting} из .env.example"
            grep "^${setting}=" .env.example >> .env
        fi
    done
    
    echo "✅ Проверка завершена"
fi
