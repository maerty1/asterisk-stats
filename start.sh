#!/bin/bash

# Скрипт для запуска asterisk-stats
# Использование: ./start.sh [start|stop|restart|status]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${SCRIPT_DIR}/app.pid"
LOG_FILE="${SCRIPT_DIR}/app.log"

# Версия Node.js (v16.20.2 совместима с этой системой)
NODE_BIN="/root/.nvm/versions/node/v16.20.2/bin/node"

# Проверка наличия Node.js
if [ ! -f "$NODE_BIN" ]; then
    echo "❌ Ошибка: Node.js не найден по пути $NODE_BIN"
    exit 1
fi

# Функция запуска приложения
start() {
    if is_running; then
        echo "⚠️  Приложение уже запущено (PID: $(cat $PID_FILE))"
        return 1
    fi
    
    echo "🚀 Запуск asterisk-stats..."
    cd "$SCRIPT_DIR"
    
    # Запускаем в фоне и сохраняем PID
    nohup $NODE_BIN app.js >> "$LOG_FILE" 2>&1 &
    PID=$!
    echo $PID > "$PID_FILE"
    
    sleep 2
    
    if is_running; then
        echo "✅ Приложение успешно запущено (PID: $PID)"
        echo "📝 Логи: $LOG_FILE"
        echo "🌐 Сервер должен быть доступен на http://localhost:${PORT:-3000}"
    else
        echo "❌ Ошибка при запуске приложения. Проверьте логи: $LOG_FILE"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Функция остановки приложения
stop() {
    if ! is_running; then
        echo "⚠️  Приложение не запущено"
        return 1
    fi
    
    PID=$(cat "$PID_FILE")
    echo "🛑 Остановка приложения (PID: $PID)..."
    
    kill "$PID" 2>/dev/null
    
    # Ждем до 10 секунд для корректной остановки
    for i in {1..10}; do
        if ! kill -0 "$PID" 2>/dev/null; then
            echo "✅ Приложение остановлено"
            rm -f "$PID_FILE"
            return 0
        fi
        sleep 1
    done
    
    # Если не остановилось, принудительно
    if kill -0 "$PID" 2>/dev/null; then
        echo "⚠️  Принудительная остановка..."
        kill -9 "$PID" 2>/dev/null
        sleep 1
        rm -f "$PID_FILE"
        echo "✅ Приложение принудительно остановлено"
    fi
}

# Функция перезапуска
restart() {
    stop
    sleep 2
    start
}

# Функция проверки статуса
status() {
    if is_running; then
        PID=$(cat "$PID_FILE")
        echo "✅ Приложение запущено (PID: $PID)"
        
        # Показываем информацию о процессе
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "📊 Статистика процесса:"
            ps -p "$PID" -o pid,ppid,%mem,%cpu,etime,cmd
        fi
        
        # Показываем последние строки логов
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo "📝 Последние строки лога:"
            tail -n 5 "$LOG_FILE"
        fi
    else
        echo "❌ Приложение не запущено"
        return 1
    fi
}

# Функция проверки, запущено ли приложение
is_running() {
    if [ ! -f "$PID_FILE" ]; then
        return 1
    fi
    
    PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -z "$PID" ]; then
        return 1
    fi
    
    if ! kill -0 "$PID" 2>/dev/null; then
        rm -f "$PID_FILE"
        return 1
    fi
    
    # Проверяем, что это действительно наш процесс node app.js
    if ! ps -p "$PID" -o cmd= | grep -q "node.*app.js"; then
        rm -f "$PID_FILE"
        return 1
    fi
    
    return 0
}

# Обработка команд
case "${1:-start}" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        status
        ;;
    *)
        echo "Использование: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac

exit $?

