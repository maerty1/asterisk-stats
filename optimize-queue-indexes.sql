-- ==========================================
-- КРИТИЧЕСКИ ВАЖНЫЕ ИНДЕКСЫ для максимальной скорости
-- ==========================================

USE asteriskcdrdb;

-- 1. Составной индекс для основного запроса по очереди (ОБЯЗАТЕЛЬНО!)
-- Покрывает WHERE queuename = ? AND time BETWEEN ? AND ? ORDER BY time
-- Проверяем существование перед созданием
SET @exist := (SELECT COUNT(*) FROM information_schema.statistics 
               WHERE table_schema = 'asteriskcdrdb' 
               AND table_name = 'queuelog' 
               AND index_name = 'idx_queuelog_queue_time_composite');
SET @sqlstmt := IF(@exist = 0, 
    'CREATE INDEX idx_queuelog_queue_time_composite ON queuelog(queuename, time)',
    'SELECT "Index idx_queuelog_queue_time_composite already exists" AS message');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Индекс для JOIN с CDR по linkedid и disposition (ОБЯЗАТЕЛЬНО!)
-- Ускоряет LEFT JOIN c ON q.callid = c.linkedid AND c.disposition = 'ANSWERED'
SET @exist := (SELECT COUNT(*) FROM information_schema.statistics 
               WHERE table_schema = 'asteriskcdrdb' 
               AND table_name = 'cdr' 
               AND index_name = 'idx_cdr_linkedid_disposition');
SET @sqlstmt := IF(@exist = 0, 
    'CREATE INDEX idx_cdr_linkedid_disposition ON cdr(linkedid, disposition, recordingfile)',
    'SELECT "Index idx_cdr_linkedid_disposition already exists" AS message');
PREPARE stmt FROM @sqlstmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Анализ таблиц для обновления статистики
ANALYZE TABLE queuelog;
ANALYZE TABLE cdr;

-- Проверка использования индексов
-- EXPLAIN SELECT ... FROM queuelog WHERE queuename = '1049' AND time BETWEEN '2025-12-01 00:00:00' AND '2025-12-01 23:59:59';

