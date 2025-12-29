# Настройка systemd службы

Приложение может быть запущено как systemd служба для более надежного управления.

## Установка службы

```bash
# Копируем файл службы
sudo cp /opt/asterisk-stats/asterisk-stats.service /etc/systemd/system/

# Перезагружаем systemd
sudo systemctl daemon-reload

# Включаем автозапуск при загрузке системы
sudo systemctl enable asterisk-stats.service

# Запускаем службу
sudo systemctl start asterisk-stats.service
```

## Управление службой

```bash
# Статус службы
sudo systemctl status asterisk-stats.service

# Запуск
sudo systemctl start asterisk-stats.service

# Остановка
sudo systemctl stop asterisk-stats.service

# Перезапуск
sudo systemctl restart asterisk-stats.service

# Просмотр логов
sudo journalctl -u asterisk-stats.service -f

# Просмотр последних логов
sudo journalctl -u asterisk-stats.service -n 50
```

## Преимущества systemd службы

- Автоматический перезапуск при сбоях
- Автозапуск при загрузке системы
- Надежное управление процессами
- Автоматический перезапуск при сохранении настроек через веб-интерфейс
- Централизованное логирование через journalctl
- Поддержка удаленной БД - служба не требует локального MySQL/MariaDB
- Совместимость с Docker и контейнерами - БД может быть в отдельном контейнере

## Примечания

- Логи доступны через `journalctl -u asterisk-stats.service`
- При использовании службы настройки автоматически применяются после сохранения через веб-интерфейс
- Если служба не установлена, приложение может работать через `start.sh`
- Файл `.env` опционален (если не существует, служба все равно запустится)

