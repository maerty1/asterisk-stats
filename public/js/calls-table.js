// ===================== ПРОСТОЙ МЕНЕДЖЕР ТАБЛИЦЫ ЗВОНКОВ =====================

// Режим отладки
const DEBUG = localStorage.getItem('DEBUG') === 'true';
const debugLog = (...args) => DEBUG && debugLog('', ...args);

class SimpleCallsTable {
  constructor() {
    debugLog('Инициализация...');
    this.calls = [];
    this.filteredCalls = [];
    this.currentPage = 1;
    this.itemsPerPage = 25;
    
    this.init();
  }

  init() {
    debugLog(' Загрузка данных...');
    
    // Находим элементы
    const dataElement = document.getElementById('calls-data');
    const tableBody = document.getElementById('calls-table-body');
    
    if (!dataElement) {
      console.error('[SimpleCallsTable] Элемент calls-data не найден!');
      return;
    }
    
    if (!tableBody) {
      console.error('[SimpleCallsTable] Элемент calls-table-body не найден!');
      return;
    }
    
    // Загружаем данные
    try {
      const dataStr = dataElement.getAttribute('data-calls');
      debugLog(' Данные получены, длина:', dataStr?.length);
      
      if (!dataStr || dataStr === '[]' || dataStr === '') {
        debugLog(' Нет данных для отображения');
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Нет данных для отображения</td></tr>';
        return;
      }
      
      this.calls = JSON.parse(dataStr);
      this.filteredCalls = [...this.calls];
      
      debugLog(' Загружено звонков:', this.calls.length);
      
      if (this.calls.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Нет данных для отображения</td></tr>';
        return;
      }
      
      // Рендерим таблицу
      this.render();
      
      // Настраиваем обработчики
      this.setupHandlers();
      
    } catch (error) {
      console.error('[SimpleCallsTable] Ошибка загрузки данных:', error);
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Ошибка загрузки данных: ' + error.message + '</td></tr>';
    }
  }

  formatDateTime(dateString) {
    if (!dateString) return '-';
    try {
      // Извлекаем дату и время напрямую из строки (данные уже в локальном времени)
      const str = dateString.toString();
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):?(\d{2})?/);
      if (match) {
        return `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}:${match[6] || '00'}`;
      }
      return dateString;
    } catch (e) {
      return dateString;
    }
  }

  formatDuration(seconds) {
    if (!seconds && seconds !== 0) return '-';
    const secs = parseInt(seconds) || 0;
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    if (mins > 0) {
      return `${mins} мин ${remainingSecs} сек`;
    }
    return `${remainingSecs} сек`;
  }

  getRecordingUrl(recordingFile) {
    if (!recordingFile) return null;
    try {
      const parts = recordingFile.split('-');
      if (parts.length < 4) return null;
      const datePart = parts[3];
      if (!datePart || datePart.length !== 8) return null;
      const year = datePart.substring(0, 4);
      const month = datePart.substring(4, 6);
      const day = datePart.substring(6, 8);
      return `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
    } catch (e) {
      return null;
    }
  }

  createRow(call) {
    // Определяем статус с учетом типа звонка (очередь/входящие/исходящие)
    let statusText, statusClass;
    
    if (call.status === 'answered') {
      statusText = 'Принят';
      statusClass = 'status-success';
    } else if (call.status === 'no_answer') {
      statusText = 'Не отвечен';
      statusClass = 'status-error';
    } else if (call.status === 'busy') {
      statusText = 'Занято';
      statusClass = 'status-warning';
    } else if (call.status === 'failed') {
      statusText = 'Неудачно';
      statusClass = 'status-error';
    } else if (call.status === 'abandoned') {
      statusText = 'Пропущен';
      statusClass = 'status-error';
    } else if (call.status === 'completed_by_agent') {
      statusText = 'Завершен агентом';
      statusClass = 'status-success';
    } else if (call.status === 'completed_by_caller') {
      statusText = 'Завершен клиентом';
      statusClass = 'status-success';
    } else {
      statusText = 'Принят';
      statusClass = 'status-success';
    }
    
    let recordingCell = '<span class="no-recording">Нет записи</span>';
    // Показываем запись для принятых звонков (answered) или обработанных (не abandoned)
    const isAnswered = call.status === 'answered' || 
                       call.status === 'completed_by_agent' || 
                       call.status === 'completed_by_caller';
    if (call.recordingFile && isAnswered) {
      const recordingUrl = this.getRecordingUrl(call.recordingFile);
      if (recordingUrl) {
        recordingCell = `
          <div class="audio-cell" data-recording="${call.recordingFile}" data-status="${call.status}">
            <audio controls preload="metadata" style="width: 100%; max-width: 300px;">
              <source src="${recordingUrl}" type="audio/mpeg">
              Ваш браузер не поддерживает аудио элемент.
            </audio>
          </div>
        `;
      }
    }
    
    const formatPhoneNumber = (number) => {
      if (!number || number === '-') return number || '-';
      const num = number.toString().trim();
      // Убираем префиксы +7 или 7 в начале
      if (num.startsWith('+7')) {
        return num.substring(2);
      }
      if (num.startsWith('7') && num.length > 10) {
        return num.substring(1);
      }
      return num;
    };

    return `
      <tr>
        <td>${this.formatDateTime(call.startTime)}</td>
        <td>${formatPhoneNumber(call.clientNumber) || '-'}</td>
        <td>${call.waitTime || 0} сек</td>
        <td>${this.formatDuration(call.duration)}</td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
        <td>${recordingCell}</td>
      </tr>
    `;
  }

  render() {
    debugLog(' Рендеринг таблицы...');
    const tableBody = document.getElementById('calls-table-body');
    if (!tableBody) {
      console.error('[SimpleCallsTable] tableBody не найден!');
      return;
    }
    
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageData = this.filteredCalls.slice(startIndex, endIndex);
    
    debugLog(' Отображаем страницу', this.currentPage, 'записей:', pageData.length);
    
    if (pageData.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Нет данных для отображения</td></tr>';
      this.updatePagination();
      return;
    }
    
    // Создаем строки
    const rows = pageData.map(call => this.createRow(call)).join('');
    tableBody.innerHTML = rows;
    
    debugLog(' Таблица отрисована, строк:', tableBody.children.length);
    
    this.updatePagination();
  }

  updatePagination() {
    const totalPages = Math.ceil(this.filteredCalls.length / this.itemsPerPage);
    const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(this.currentPage * this.itemsPerPage, this.filteredCalls.length);
    
    const infoEl = document.getElementById('pagination-info');
    if (infoEl) {
      infoEl.textContent = `Показано ${startItem}-${endItem} из ${this.filteredCalls.length} записей`;
    }
    
    const controlsEl = document.getElementById('pagination-controls');
    if (controlsEl) {
      let html = '';
      if (totalPages > 1) {
        if (this.currentPage > 1) {
          html += `<button onclick="window.callsTable.goToPage(${this.currentPage - 1})">← Предыдущая</button> `;
        }
        html += `<span>Страница ${this.currentPage} из ${totalPages}</span>`;
        if (this.currentPage < totalPages) {
          html += ` <button onclick="window.callsTable.goToPage(${this.currentPage + 1})">Следующая →</button>`;
        }
      }
      controlsEl.innerHTML = html;
    }
  }

  goToPage(page) {
    const totalPages = Math.ceil(this.filteredCalls.length / this.itemsPerPage);
    if (page < 1 || page > totalPages) return;
    this.currentPage = page;
    this.render();
  }

  setupHandlers() {
    // Поиск
    const searchInput = document.getElementById('table-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase();
        this.filteredCalls = this.calls.filter(call => {
          const client = (call.clientNumber || '').toLowerCase();
          const status = (call.status || '').toLowerCase();
          return client.includes(term) || status.includes(term);
        });
        this.currentPage = 1;
        this.render();
      });
    }
    
    // Фильтр статуса
    const statusFilter = document.getElementById('status-filter');
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        const status = e.target.value;
        this.filteredCalls = status ? 
          this.calls.filter(call => call.status === status) : 
          [...this.calls];
        this.currentPage = 1;
        this.render();
      });
    }
    
    // Количество на странице
    const itemsPerPage = document.getElementById('items-per-page');
    if (itemsPerPage) {
      itemsPerPage.addEventListener('change', (e) => {
        this.itemsPerPage = parseInt(e.target.value) || 25;
        this.currentPage = 1;
        this.render();
      });
    }
  }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
  debugLog(' DOM загружен, инициализация таблицы...');
  window.callsTable = new SimpleCallsTable();
});

