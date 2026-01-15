/**
 * WebSocket клиент для real-time обновлений
 */

class RealTimeClient {
  constructor(options = {}) {
    this.socket = null;
    this.connected = false;
    this.subscribedQueues = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 10;
    this.reconnectDelay = options.reconnectDelay || 3000;
    
    // Callbacks
    this.onConnect = options.onConnect || (() => {});
    this.onDisconnect = options.onDisconnect || (() => {});
    this.onQueueStats = options.onQueueStats || (() => {});
    this.onSystemStatus = options.onSystemStatus || (() => {});
    this.onNewCall = options.onNewCall || (() => {});
    this.onCallEnded = options.onCallEnded || (() => {});
    this.onError = options.onError || console.error;
  }

  /**
   * Подключиться к WebSocket серверу
   */
  connect() {
    if (typeof io === 'undefined') {
      console.warn('Socket.IO не загружен, загружаю...');
      this.loadSocketIO().then(() => this.initSocket());
      return;
    }
    this.initSocket();
  }

  /**
   * Загрузить Socket.IO библиотеку
   */
  loadSocketIO() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/socket.io/socket.io.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Инициализировать сокет
   */
  initSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}`;
    
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: this.reconnectDelay
    });

    this.socket.on('connect', () => {
      console.log('[WebSocket] Подключено');
      this.connected = true;
      this.reconnectAttempts = 0;
      this.onConnect();
      
      // Переподписываемся на очереди
      this.subscribedQueues.forEach(queue => {
        this.socket.emit('subscribe:queue', queue);
      });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('[WebSocket] Отключено:', reason);
      this.connected = false;
      this.onDisconnect(reason);
    });

    this.socket.on('connect_error', (error) => {
      console.error('[WebSocket] Ошибка подключения:', error);
      this.onError(error);
    });

    // Обработчики событий
    this.socket.on('queue:stats', (data) => {
      this.onQueueStats(data);
    });

    this.socket.on('system:status', (data) => {
      this.onSystemStatus(data);
    });

    this.socket.on('queue:newCall', (data) => {
      this.onNewCall(data);
    });

    this.socket.on('queue:callEnded', (data) => {
      this.onCallEnded(data);
    });
  }

  /**
   * Подписаться на обновления очереди
   * @param {string} queueName - Название очереди
   */
  subscribeToQueue(queueName) {
    if (this.connected && this.socket) {
      this.socket.emit('subscribe:queue', queueName);
    }
    this.subscribedQueues.add(queueName);
  }

  /**
   * Отписаться от обновлений очереди
   * @param {string} queueName - Название очереди
   */
  unsubscribeFromQueue(queueName) {
    if (this.connected && this.socket) {
      this.socket.emit('unsubscribe:queue', queueName);
    }
    this.subscribedQueues.delete(queueName);
  }

  /**
   * Запросить статус системы
   */
  requestStatus() {
    if (this.connected && this.socket) {
      this.socket.emit('get:status');
    }
  }

  /**
   * Отключиться
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected = false;
    this.subscribedQueues.clear();
  }

  /**
   * Проверить подключение
   */
  isConnected() {
    return this.connected && this.socket?.connected;
  }
}

/**
 * Компонент для отображения real-time статистики
 */
class RealTimeStatsWidget {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.queueName = options.queueName;
    this.client = null;
    this.stats = null;
    
    if (!this.container) {
      console.error(`Контейнер #${containerId} не найден`);
      return;
    }
    
    this.init();
  }

  init() {
    this.render();
    this.connect();
  }

  connect() {
    this.client = new RealTimeClient({
      onConnect: () => this.updateConnectionStatus(true),
      onDisconnect: () => this.updateConnectionStatus(false),
      onQueueStats: (data) => this.updateStats(data),
      onSystemStatus: (data) => this.updateSystemStatus(data),
      onNewCall: (data) => this.showNotification('Новый звонок', data),
      onCallEnded: (data) => this.showNotification('Звонок завершен', data)
    });
    
    this.client.connect();
    
    if (this.queueName) {
      setTimeout(() => {
        this.client.subscribeToQueue(this.queueName);
      }, 1000);
    }
  }

  render() {
    this.container.innerHTML = `
      <div class="realtime-widget">
        <div class="realtime-header">
          <span class="realtime-title">📡 Real-time статистика</span>
          <span class="realtime-status" id="ws-status">Подключение...</span>
        </div>
        <div class="realtime-stats" id="realtime-stats">
          <div class="realtime-stat">
            <span class="stat-label">Ожидают</span>
            <span class="stat-value" id="rt-waiting">-</span>
          </div>
          <div class="realtime-stat">
            <span class="stat-label">За 5 мин</span>
            <span class="stat-value" id="rt-recent">-</span>
          </div>
          <div class="realtime-stat">
            <span class="stat-label">Отвечено</span>
            <span class="stat-value" id="rt-answered">-</span>
          </div>
          <div class="realtime-stat">
            <span class="stat-label">Ср. ожидание</span>
            <span class="stat-value" id="rt-wait-time">-</span>
          </div>
        </div>
        <div class="realtime-footer">
          <span id="rt-last-update">Обновление...</span>
        </div>
      </div>
    `;
  }

  updateConnectionStatus(connected) {
    const statusEl = document.getElementById('ws-status');
    if (statusEl) {
      statusEl.textContent = connected ? '🟢 Онлайн' : '🔴 Оффлайн';
      statusEl.className = `realtime-status ${connected ? 'connected' : 'disconnected'}`;
    }
  }

  updateStats(data) {
    if (data.queueName !== this.queueName) return;
    
    this.stats = data.stats;
    
    const waiting = document.getElementById('rt-waiting');
    const recent = document.getElementById('rt-recent');
    const answered = document.getElementById('rt-answered');
    const waitTime = document.getElementById('rt-wait-time');
    const lastUpdate = document.getElementById('rt-last-update');
    
    if (waiting) waiting.textContent = data.stats.waitingNow || 0;
    if (recent) recent.textContent = data.stats.recentTotal || 0;
    if (answered) answered.textContent = data.stats.recentAnswered || 0;
    if (waitTime) waitTime.textContent = `${data.stats.avgWaitTime || 0} сек`;
    if (lastUpdate) {
      const time = new Date(data.stats.lastUpdate).toLocaleTimeString('ru-RU');
      lastUpdate.textContent = `Обновлено: ${time}`;
    }
  }

  updateSystemStatus(data) {
    // Можно добавить отображение системного статуса
  }

  showNotification(title, data) {
    // Показываем уведомление о новом звонке
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body: `Очередь: ${data.queueName}`,
        icon: '/favicon.ico'
      });
    }
  }

  setQueue(queueName) {
    if (this.queueName) {
      this.client.unsubscribeFromQueue(this.queueName);
    }
    this.queueName = queueName;
    if (this.client.isConnected()) {
      this.client.subscribeToQueue(queueName);
    }
  }

  destroy() {
    if (this.client) {
      this.client.disconnect();
    }
  }
}

// Экспорт в глобальную область
window.RealTimeClient = RealTimeClient;
window.RealTimeStatsWidget = RealTimeStatsWidget;
