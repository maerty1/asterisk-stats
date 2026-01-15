/**
 * Asterisk Stats - TypeScript Type Definitions
 * Для автодополнения в IDE (VS Code, Cursor)
 */

// ============================================
// Call Types
// ============================================

/**
 * Базовая информация о звонке
 */
interface Call {
  /** Уникальный идентификатор звонка */
  uniqueid: string;
  /** Связанный ID (для связи CDR и queuelog) */
  linkedid: string;
  /** Время начала звонка */
  calldate: string;
  /** Номер клиента */
  src: string;
  /** Номер назначения */
  dst: string;
  /** Статус звонка */
  disposition: 'ANSWERED' | 'NO ANSWER' | 'BUSY' | 'FAILED';
  /** Длительность звонка в секундах */
  duration: number;
  /** Время разговора в секундах */
  billsec: number;
}

/**
 * Звонок из очереди (расширенный)
 */
interface QueueCall extends Call {
  /** Название очереди */
  queuename: string;
  /** Время ожидания в очереди (секунды) */
  waitTime: number;
  /** Время входа в очередь */
  startTime: string;
  /** Время ответа агента */
  answerTime?: string;
  /** Номер агента */
  agent?: string;
  /** Статус в очереди */
  status: 'ANSWERED' | 'ABANDON' | 'EXITWITHTIMEOUT' | 'EXITEMPTY';
  /** Статус перезвона */
  callbackStatus?: CallbackStatus;
}

/**
 * Статус перезвона
 */
type CallbackStatus = 
  | 'client_callback'  // Клиент перезвонил сам
  | 'agent_callback'   // Агент перезвонил клиенту
  | 'no_callback'      // Не обработан
  | 'processed';       // Обработан (отвечен)

// ============================================
// Statistics Types
// ============================================

/**
 * Статистика очереди
 */
interface QueueStats {
  /** Всего звонков */
  totalCalls: number;
  /** Отвеченные звонки */
  answeredCalls: number;
  /** Пропущенные звонки */
  abandonedCalls: number;
  /** Процент ответа */
  answerRate: number;
  /** SLA (% отвеченных за 20 сек) */
  sla: number;
  /** Среднее время ответа (секунды) */
  asa: number;
  /** Средняя длительность разговора */
  avgDuration: number;
  /** Процент пропущенных */
  abandonRate: number;
}

/**
 * Статистика перезвонов
 */
interface CallbackStats {
  /** Клиент перезвонил сам */
  clientCallbacks: number;
  /** Агент перезвонил */
  agentCallbacks: number;
  /** Не обработано */
  noCallbacks: number;
  /** Всего пропущенных */
  totalAbandoned: number;
}

/**
 * Почасовая статистика
 */
interface HourlyStats {
  /** Час (0-23) */
  hour: number;
  /** Количество звонков */
  calls: number;
  /** Отвеченные */
  answered: number;
}

// ============================================
// Rankings Types
// ============================================

/**
 * Рейтинг очереди
 */
interface QueueRanking {
  /** Позиция в рейтинге */
  rank: number;
  /** Название очереди */
  queueName: string;
  /** Отображаемое название */
  queueDisplayName: string;
  /** Отдел */
  department?: string;
  /** Всего звонков */
  totalCalls: number;
  /** Отвеченные */
  answeredCalls: number;
  /** Пропущенные */
  abandonedCalls: number;
  /** Процент ответа */
  answerRate: number;
  /** SLA */
  slaRate: number;
  /** ASA */
  asa: number;
  /** Комплексный рейтинг (0-100) */
  compositeScore: number;
  /** Перезвонил сам */
  clientCallbacks: number;
  /** Перезвонили мы */
  agentCallbacks: number;
  /** Не обработан */
  noCallbacks: number;
}

// ============================================
// Comparison Types
// ============================================

/**
 * Период для сравнения
 */
interface ComparisonPeriod {
  /** Дата начала (YYYY-MM-DD) */
  start: string;
  /** Дата конца (YYYY-MM-DD) */
  end: string;
  /** Метка периода */
  label: string;
}

/**
 * Изменение метрики
 */
interface MetricChange {
  /** Абсолютное изменение */
  value: number;
  /** Процентное изменение */
  percent: number;
  /** Направление тренда */
  trend: 'up' | 'down' | 'neutral';
  /** Положительное изменение */
  isPositive?: boolean;
  /** Отрицательное изменение */
  isNegative?: boolean;
}

/**
 * Сравнение статистики
 */
interface StatsComparison {
  totalCalls: { current: number; previous: number; change: MetricChange };
  answeredCalls: { current: number; previous: number; change: MetricChange };
  abandonedCalls: { current: number; previous: number; change: MetricChange };
  answerRate: { current: number; previous: number; change: MetricChange };
  sla: { current: number; previous: number; change: MetricChange };
  asa: { current: number; previous: number; change: MetricChange };
}

// ============================================
// API Types
// ============================================

/**
 * Базовый ответ API
 */
interface ApiResponse<T = any> {
  /** Успешность запроса */
  success: boolean;
  /** Данные (при успехе) */
  data?: T;
  /** Сообщение об ошибке */
  error?: string;
  /** Дополнительная информация */
  message?: string;
}

/**
 * Health Check ответ
 */
interface HealthResponse {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: {
    seconds: number;
    formatted: string;
  };
  version: string;
  node: string;
  database: {
    connected: boolean;
    latency: number;
  };
  memory: {
    heapUsed: string;
    heapTotal: string;
    rss: string;
  };
}

// ============================================
// Settings Types
// ============================================

/**
 * Настройки приложения
 */
interface AppSettings {
  DB_HOST: string;
  DB_USER: string;
  DB_PASS: string;
  DB_NAME: string;
  DB_CONNECTION_LIMIT: string;
  TIMEZONE: string;
  SMTP_HOST: string;
  SMTP_USER: string;
  SMTP_PASS: string;
  SMTP_PORT: string;
  EMAIL_FROM: string;
  EMAIL_CRON_SCHEDULE: string;
  SLA_THRESHOLD: string;
  CALLBACK_WINDOW_HOURS: string;
  OUTBOUND_MIN_LENGTH: string;
  WORK_HOURS_ENABLED: string;
  WORK_HOURS_START: string;
  WORK_HOURS_END: string;
}

/**
 * Email отчет
 */
interface EmailReport {
  id: number;
  queue_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================
// WebSocket Types
// ============================================

/**
 * Real-time статистика очереди
 */
interface RealTimeQueueStats {
  /** Звонков за 5 минут */
  recentTotal: number;
  /** Отвечено за 5 минут */
  recentAnswered: number;
  /** Пропущено за 5 минут */
  recentAbandoned: number;
  /** Среднее ожидание (сек) */
  avgWaitTime: number;
  /** Ожидают сейчас */
  waitingNow: number;
  /** Время последнего обновления */
  lastUpdate: string;
}

/**
 * Статус системы (WebSocket)
 */
interface SystemStatus {
  status: 'healthy' | 'unhealthy';
  database: {
    connected: boolean;
    latency: number;
  };
  todayCalls: number;
  todayAnswered: number;
  uptime: number;
  memory: NodeJS.MemoryUsage;
  timestamp: string;
}

// ============================================
// i18n Types
// ============================================

/**
 * Функция перевода
 */
type TranslateFunction = (key: string, params?: Record<string, any>) => string;

/**
 * Поддерживаемые локали
 */
type SupportedLocale = 'ru' | 'en';

// ============================================
// Express Extensions
// ============================================

declare global {
  namespace Express {
    interface Request {
      /** Текущая локаль */
      locale: SupportedLocale;
    }
    interface Response {
      locals: {
        /** Функция перевода */
        t: TranslateFunction;
        /** Текущая локаль */
        locale: SupportedLocale;
        /** Доступные локали */
        locales: SupportedLocale[];
      };
    }
  }
}

export {
  Call,
  QueueCall,
  CallbackStatus,
  QueueStats,
  CallbackStats,
  HourlyStats,
  QueueRanking,
  ComparisonPeriod,
  MetricChange,
  StatsComparison,
  ApiResponse,
  HealthResponse,
  AppSettings,
  EmailReport,
  RealTimeQueueStats,
  SystemStatus,
  TranslateFunction,
  SupportedLocale
};
