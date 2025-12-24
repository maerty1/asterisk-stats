// ===================== ПРОСТОЙ МЕНЕДЖЕР ТАБЛИЦЫ ЗВОНКОВ =====================

class SimpleCallsTable {
  constructor() {
    console.log('[SimpleCallsTable] Инициализация...');
    this.calls = [];
    this.filteredCalls = [];
    this.currentPage = 1;
    this.itemsPerPage = 25;
    
    this.init();
  }

  init() {
    console.log('[SimpleCallsTable] Загрузка данных...');
    
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
      console.log('[SimpleCallsTable] Данные получены, длина:', dataStr?.length);
      
      if (!dataStr || dataStr === '[]' || dataStr === '') {
        console.log('[SimpleCallsTable] Нет данных для отображения');
        tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Нет данных для отображения</td></tr>';
        return;
      }
      
      this.calls = JSON.parse(dataStr);
      this.filteredCalls = [...this.calls];
      
      console.log('[SimpleCallsTable] Загружено звонков:', this.calls.length);
      
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
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
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
    const statusText = call.status === 'abandoned' ? 'Пропущен' : 
                      call.status === 'completed_by_agent' ? 'Завершен агентом' :
                      call.status === 'completed_by_caller' ? 'Завершен клиентом' : 'Принят';
    const statusClass = call.status === 'abandoned' ? 'status-error' : 'status-success';
    
    let recordingCell = '<span class="no-recording">Нет записи</span>';
    if (call.recordingFile && call.status !== 'abandoned') {
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
    
    return `
      <tr>
        <td>${this.formatDateTime(call.startTime)}</td>
        <td>${call.clientNumber || '-'}</td>
        <td>${call.waitTime || 0} сек</td>
        <td>${this.formatDuration(call.duration)}</td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
        <td>${recordingCell}</td>
      </tr>
    `;
  }

  render() {
    console.log('[SimpleCallsTable] Рендеринг таблицы...');
    const tableBody = document.getElementById('calls-table-body');
    if (!tableBody) {
      console.error('[SimpleCallsTable] tableBody не найден!');
      return;
    }
    
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageData = this.filteredCalls.slice(startIndex, endIndex);
    
    console.log('[SimpleCallsTable] Отображаем страницу', this.currentPage, 'записей:', pageData.length);
    
    if (pageData.length === 0) {
      tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Нет данных для отображения</td></tr>';
      this.updatePagination();
      return;
    }
    
    // Создаем строки
    const rows = pageData.map(call => this.createRow(call)).join('');
    tableBody.innerHTML = rows;
    
    console.log('[SimpleCallsTable] Таблица отрисована, строк:', tableBody.children.length);
    
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
  console.log('[SimpleCallsTable] DOM загружен, инициализация таблицы...');
  window.callsTable = new SimpleCallsTable();
});

