/**
 * WebSocket модуль для real-time обновлений
 * Использует Socket.IO для двусторонней связи
 * @module websocket
 */

/**
 * @typedef {import('./types').RealTimeQueueStats} RealTimeQueueStats
 * @typedef {import('./types').SystemStatus} SystemStatus
 * @typedef {import('socket.io').Server} SocketIOServer
 * @typedef {import('socket.io').Socket} Socket
 */

const { Server } = require('socket.io');
const logger = require('./logger');
const { execute: dbExecute } = require('./db-optimizer');

let io = null;
let updateInterval = null;

// Интервал обновления статистики (в мс)
const UPDATE_INTERVAL = process.env.WS_UPDATE_INTERVAL || 30000; // 30 секунд

/**
 * Инициализировать WebSocket сервер
 * @param {http.Server} server - HTTP сервер
 */
function initWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    transports: ['websocket', 'polling']
  });

  io.on('connection', (socket) => {
    logger.info(`[WebSocket] Клиент подключен: ${socket.id}`);
    
    // Отправляем текущий статус
    sendSystemStatus(socket);
    
    // Подписка на обновления очереди
    socket.on('subscribe:queue', async (queueName) => {
      socket.join(`queue:${queueName}`);
      logger.info(`[WebSocket] ${socket.id} подписался на очередь: ${queueName}`);
      
      // Отправляем текущую статистику
      const stats = await getQueueRealTimeStats(queueName);
      socket.emit('queue:stats', { queueName, stats });
    });
    
    // Отписка от очереди
    socket.on('unsubscribe:queue', (queueName) => {
      socket.leave(`queue:${queueName}`);
      logger.info(`[WebSocket] ${socket.id} отписался от очереди: ${queueName}`);
    });
    
    // Запрос статуса системы
    socket.on('get:status', () => {
      sendSystemStatus(socket);
    });
    
    // Отключение
    socket.on('disconnect', (reason) => {
      logger.info(`[WebSocket] Клиент отключен: ${socket.id}, причина: ${reason}`);
    });
  });

  // Запускаем периодическое обновление
  startPeriodicUpdates();

  logger.info('[WebSocket] Сервер инициализирован');
  
  return io;
}

/**
 * Запустить периодические обновления
 */
function startPeriodicUpdates() {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  
  updateInterval = setInterval(async () => {
    try {
      // Обновляем статистику для всех подписанных очередей
      const rooms = io.sockets.adapter.rooms;
      
      for (const [room, sockets] of rooms) {
        if (room.startsWith('queue:')) {
          const queueName = room.replace('queue:', '');
          const stats = await getQueueRealTimeStats(queueName);
          io.to(room).emit('queue:stats', { queueName, stats, timestamp: new Date().toISOString() });
        }
      }
      
      // Обновляем общий статус системы
      const systemStatus = await getSystemStatus();
      io.emit('system:status', systemStatus);
      
    } catch (error) {
      logger.error('[WebSocket] Ошибка периодического обновления:', error);
    }
  }, UPDATE_INTERVAL);
}

/**
 * Получить статистику очереди в реальном времени
 * @param {string} queueName - Название очереди
 */
async function getQueueRealTimeStats(queueName) {
  try {
    // Получаем статистику за последние 5 минут
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const formattedDate = fiveMinutesAgo.toISOString().slice(0, 19).replace('T', ' ');
    
    const [recentCalls] = await dbExecute(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN event = 'CONNECT' THEN 1 ELSE 0 END) as answered,
        SUM(CASE WHEN event = 'ABANDON' THEN 1 ELSE 0 END) as abandoned,
        AVG(CASE WHEN event = 'CONNECT' THEN data1 ELSE NULL END) as avg_wait
      FROM queuelog
      WHERE queuename = ? AND time >= ?
    `, [queueName, formattedDate]);
    
    // Получаем количество ожидающих в очереди
    const [waiting] = await dbExecute(`
      SELECT COUNT(DISTINCT callid) as waiting
      FROM queuelog q1
      WHERE queuename = ? 
        AND event = 'ENTERQUEUE'
        AND time >= ?
        AND NOT EXISTS (
          SELECT 1 FROM queuelog q2 
          WHERE q2.callid = q1.callid 
            AND q2.queuename = q1.queuename
            AND q2.event IN ('CONNECT', 'ABANDON', 'EXITWITHTIMEOUT')
            AND q2.time > q1.time
        )
    `, [queueName, formattedDate]);
    
    return {
      recentTotal: recentCalls?.total || 0,
      recentAnswered: recentCalls?.answered || 0,
      recentAbandoned: recentCalls?.abandoned || 0,
      avgWaitTime: Math.round(recentCalls?.avg_wait || 0),
      waitingNow: waiting?.waiting || 0,
      lastUpdate: new Date().toISOString()
    };
  } catch (error) {
    logger.error(`[WebSocket] Ошибка получения статистики очереди ${queueName}:`, error);
    return null;
  }
}

/**
 * Получить статус системы
 */
async function getSystemStatus() {
  try {
    // Проверяем подключение к БД
    const start = Date.now();
    await dbExecute('SELECT 1');
    const dbLatency = Date.now() - start;
    
    // Получаем общую статистику за сегодня из cdr (таблица в asteriskcdrdb)
    let todayStats = { total: 0, answered: 0 };
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [stats] = await dbExecute(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN disposition = 'ANSWERED' THEN 1 ELSE 0 END) as answered
        FROM asteriskcdrdb.cdr
        WHERE DATE(calldate) = ?
      `, [today]);
      todayStats = stats || { total: 0, answered: 0 };
    } catch (statsError) {
      // Если таблица cdr недоступна, просто используем нули (не спамим в логи)
    }
    
    return {
      status: 'healthy',
      database: {
        connected: true,
        latency: dbLatency
      },
      todayCalls: todayStats?.total || 0,
      todayAnswered: todayStats?.answered || 0,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('[WebSocket] Ошибка получения статуса системы:', error);
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Отправить статус системы клиенту
 * @param {Socket} socket - Socket клиента
 */
async function sendSystemStatus(socket) {
  const status = await getSystemStatus();
  socket.emit('system:status', status);
}

/**
 * Отправить событие всем подключенным клиентам
 * @param {string} event - Название события
 * @param {*} data - Данные
 */
function broadcast(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

/**
 * Отправить событие в комнату (конкретной очереди)
 * @param {string} room - Название комнаты
 * @param {string} event - Название события
 * @param {*} data - Данные
 */
function broadcastToRoom(room, event, data) {
  if (io) {
    io.to(room).emit(event, data);
  }
}

/**
 * Уведомить о новом звонке
 * @param {string} queueName - Название очереди
 * @param {Object} callData - Данные звонка
 */
function notifyNewCall(queueName, callData) {
  broadcastToRoom(`queue:${queueName}`, 'queue:newCall', {
    queueName,
    call: callData,
    timestamp: new Date().toISOString()
  });
}

/**
 * Уведомить о завершении звонка
 * @param {string} queueName - Название очереди
 * @param {Object} callData - Данные звонка
 */
function notifyCallEnded(queueName, callData) {
  broadcastToRoom(`queue:${queueName}`, 'queue:callEnded', {
    queueName,
    call: callData,
    timestamp: new Date().toISOString()
  });
}

/**
 * Остановить WebSocket сервер
 */
function stopWebSocket() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
  
  if (io) {
    io.close();
    io = null;
  }
  
  logger.info('[WebSocket] Сервер остановлен');
}

/**
 * Получить количество подключенных клиентов
 */
function getConnectedClients() {
  return io ? io.sockets.sockets.size : 0;
}

module.exports = {
  initWebSocket,
  stopWebSocket,
  broadcast,
  broadcastToRoom,
  notifyNewCall,
  notifyCallEnded,
  getConnectedClients,
  getSystemStatus,
  getQueueRealTimeStats
};
