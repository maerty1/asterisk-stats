-- ==========================================
-- Скрипт оптимизации индексов для Asterisk Queue Analytics
-- ==========================================
-- Этот скрипт создает индексы для ускорения запросов к базе данных
-- ВАЖНО: Выполняйте на тестовой базе данных перед применением на продакшене
-- Индексы могут занять дополнительное место на диске и замедлить INSERT/UPDATE операции

USE asteriskcdrdb;

-- ==========================================
-- Индексы для таблицы queuelog
-- ==========================================

-- Индекс для поиска по очереди и времени (основной запрос)
-- Используется в getQueueCalls
CREATE INDEX IF NOT EXISTS idx_queuelog_queue_time 
ON queuelog(queuename, time);

-- Индекс для поиска по callid (для JOIN операций)
CREATE INDEX IF NOT EXISTS idx_queuelog_callid 
ON queuelog(callid);

-- Индекс для поиска по событию и очереди
-- Используется в checkCallbacksBatch
CREATE INDEX IF NOT EXISTS idx_queuelog_event_queue 
ON queuelog(event, queuename, time);

-- Композитный индекс для поиска перезвонов
-- Используется в checkCallbacksBatch для поиска перезвонов в очереди
CREATE INDEX IF NOT EXISTS idx_queuelog_queue_event_time_callid 
ON queuelog(queuename, event, time, callid);

-- Индекс для поиска по событию ENTERQUEUE (для получения номера клиента)
CREATE INDEX IF NOT EXISTS idx_queuelog_enterqueue 
ON queuelog(callid, event, data2) 
WHERE event = 'ENTERQUEUE';

-- ==========================================
-- Индексы для таблицы cdr
-- ==========================================

-- Индекс для поиска по дате (основной запрос для входящих/исходящих)
-- Используется в getInboundCalls, getOutboundCalls
CREATE INDEX IF NOT EXISTS idx_cdr_calldate 
ON cdr(calldate);

-- Индекс для поиска по linkedid (для JOIN с queuelog)
-- Используется в getQueueCalls
CREATE INDEX IF NOT EXISTS idx_cdr_linkedid 
ON cdr(linkedid, disposition);

-- Индекс для поиска по disposition и billsec (для фильтрации отвеченных)
-- Используется в checkCallbacksBatch
CREATE INDEX IF NOT EXISTS idx_cdr_disposition_billsec 
ON cdr(disposition, billsec, calldate);

-- Индекс для поиска по src (для поиска перезвонов от клиента)
-- Используется в checkCallbacksBatch, checkCallbacksBatchInbound
CREATE INDEX IF NOT EXISTS idx_cdr_src_calldate 
ON cdr(src(20), calldate, disposition, billsec);

-- Индекс для поиска по dst (для поиска перезвонов от агента)
-- Используется в checkCallbacksBatch, checkCallbacksBatchInbound
CREATE INDEX IF NOT EXISTS idx_cdr_dst_calldate 
ON cdr(dst(20), calldate, disposition, billsec);

-- Индекс для поиска исходящих звонков
-- Используется в getOutboundCalls, checkCallbacksBatchInbound
CREATE INDEX IF NOT EXISTS idx_cdr_outbound 
ON cdr(outbound_cnum(20), calldate, lastapp, dst(20));

-- Композитный индекс для входящих звонков
-- Используется в getInboundCalls, checkCallbacksBatchInbound
CREATE INDEX IF NOT EXISTS idx_cdr_inbound 
ON cdr(calldate, src(20), dst(20), disposition);

-- Индекс для поиска по dcontext (для фильтрации внутренних звонков)
CREATE INDEX IF NOT EXISTS idx_cdr_dcontext 
ON cdr(dcontext(50), calldate, disposition);

-- ==========================================
-- Оптимизация существующих индексов
-- ==========================================

-- Проверка существующих индексов
-- Выполните этот запрос, чтобы увидеть все индексы:
-- SHOW INDEXES FROM queuelog;
-- SHOW INDEXES FROM cdr;

-- ==========================================
-- Рекомендации по анализу производительности
-- ==========================================

-- Используйте EXPLAIN для анализа запросов:
-- EXPLAIN SELECT ... FROM queuelog WHERE ...;
-- EXPLAIN SELECT ... FROM cdr WHERE ...;

-- Мониторинг использования индексов:
-- SELECT * FROM sys.schema_unused_indexes WHERE object_schema = 'asteriskcdrdb';

-- ==========================================
-- Примечания
-- ==========================================
-- 1. Индексы на строковых полях с префиксом (например, src(20)) ограничивают длину
--    индексируемой части строки для экономии места
-- 2. После создания индексов рекомендуется выполнить ANALYZE TABLE:
--    ANALYZE TABLE queuelog;
--    ANALYZE TABLE cdr;
-- 3. Для больших таблиц создание индексов может занять время
-- 4. Регулярно проверяйте использование индексов и удаляйте неиспользуемые

