// ===================== ПОЛНОСТЬЮ ПЕРЕПИСАННАЯ СИСТЕМА ГРАФИКА И ТАБЛИЦЫ =====================

// ===================== ГРАФИК =====================

class ChartManager {
  constructor() {
    logger.log('=== ChartManager initialized ===');
  }

  createChart(data) {
    logger.log('=== CREATING CHART ===');
    logger.log('Input data:', data);

    const container = document.getElementById('chart-container');
    if (!container) {
      logger.error('Chart container not found');
      return;
    }

    // Очищаем контейнер
    container.innerHTML = '';

    // Проверяем данные
    if (!data || !data.calls || !Array.isArray(data.calls) || data.calls.length === 0) {
      logger.log('No data available, showing placeholder');
      this.showPlaceholder(container, 'Нет данных для отображения');
      return;
    }

    // Создаем заголовок
    const title = document.createElement('h3');
    title.className = 'chart-title';
    title.textContent = 'Статистика звонков';
    container.appendChild(title);

    // Группируем данные по дням
    const callsByDay = {};
    data.calls.forEach(call => {
      try {
        if (!call.startTime) return;

        // Извлекаем дату напрямую из строки (данные уже в локальном времени)
        const str = call.startTime.toString();
        const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return;

        const dateKey = `${match[3]}.${match[2]}`; // DD.MM

        if (!callsByDay[dateKey]) {
          callsByDay[dateKey] = { answered: 0, abandoned: 0 };
        }

        // Определяем статус
        if (call.status === 'abandoned' || call.status === 'completed_by_caller') {
          callsByDay[dateKey].abandoned++;
        } else {
          callsByDay[dateKey].answered++;
        }
      } catch (e) {
        logger.error('Error processing call:', e);
      }
    });

    logger.log('Calls by day:', callsByDay);

    // Находим максимальное значение
    const dates = Object.keys(callsByDay).sort();
    const maxValue = Math.max(...dates.flatMap(date => [
      callsByDay[date].answered,
      callsByDay[date].abandoned
    ]));

    logger.log('Dates:', dates, 'Max value:', maxValue);

    // Создаем контейнер графика
    const chartDiv = document.createElement('div');
    chartDiv.className = 'simple-bar-chart';

    // Создаем шкалу Y
    const yAxis = document.createElement('div');
    yAxis.className = 'chart-y-axis';

    for (let i = 5; i >= 0; i--) {
      const label = document.createElement('div');
      label.className = 'y-label';
      label.textContent = Math.round((maxValue * i) / 5);
      yAxis.appendChild(label);
    }
    chartDiv.appendChild(yAxis);

    // Создаем область графика
    const chartArea = document.createElement('div');
    chartArea.className = 'chart-area';

    const chartBars = document.createElement('div');
    chartBars.className = 'chart-bars';

    // Создаем бары для каждой даты
    dates.forEach(date => {
      const group = document.createElement('div');
      group.className = 'bar-group';

      const answered = callsByDay[date].answered;
      const abandoned = callsByDay[date].abandoned;

      // Зеленый бар (принятые)
      const answeredBar = document.createElement('div');
      answeredBar.className = 'bar answered-bar';
      answeredBar.style.height = maxValue > 0 ? `${Math.max((answered / maxValue) * 200, 4)}px` : '4px';
      answeredBar.title = `Принятые: ${answered}`;

      if (answered > 0) {
        const valueSpan = document.createElement('span');
        valueSpan.className = 'bar-value';
        valueSpan.textContent = answered;
        answeredBar.appendChild(valueSpan);
      }

      // Оранжевый бар (пропущенные)
      const abandonedBar = document.createElement('div');
      abandonedBar.className = 'bar abandoned-bar';
      abandonedBar.style.height = maxValue > 0 ? `${Math.max((abandoned / maxValue) * 200, 4)}px` : '4px';
      abandonedBar.title = `Пропущенные: ${abandoned}`;

      if (abandoned > 0) {
        const valueSpan = document.createElement('span');
        valueSpan.className = 'bar-value';
        valueSpan.textContent = abandoned;
        abandonedBar.appendChild(valueSpan);
      }

      // Метка даты
      const label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = date;

      group.appendChild(answeredBar);
      group.appendChild(abandonedBar);
      group.appendChild(label);
      chartBars.appendChild(group);
    });

    chartArea.appendChild(chartBars);
    chartDiv.appendChild(chartArea);

    // Создаем легенду
    const legend = document.createElement('div');
    legend.className = 'chart-legend';

    const legendItems = [
      { class: 'answered', text: 'Принятые' },
      { class: 'abandoned', text: 'Пропущенные' }
    ];

    legendItems.forEach(item => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'legend-item';

      const colorDiv = document.createElement('div');
      colorDiv.className = `legend-color ${item.class}`;

      const textSpan = document.createElement('span');
      textSpan.textContent = item.text;

      itemDiv.appendChild(colorDiv);
      itemDiv.appendChild(textSpan);
      legend.appendChild(itemDiv);
    });

    chartDiv.appendChild(legend);
    container.appendChild(chartDiv);

    logger.log('Chart created successfully');
  }

  showPlaceholder(container, message) {
    container.innerHTML = `
      <h3 class="chart-title">Статистика звонков</h3>
      <div class="chart-placeholder">
        <div class="chart-placeholder-icon">📊</div>
        <div class="chart-placeholder-text">${message}</div>
      </div>
    `;
  }
}

// ===================== ТАБЛИЦА =====================

class CallsTableManager {
  constructor() {
    logger.log('=== CallsTableManager constructor ===');

    this.calls = [];
    this.filteredCalls = [];
    this.currentPage = 1;
    this.itemsPerPage = 25;
    this.sortField = 'date';
    this.sortDirection = 'asc'; // Старые звонки сверху
    this.searchTerm = '';

    this.tableBody = document.getElementById('calls-table-body');
    this.paginationControls = document.getElementById('pagination-controls');
    this.searchInput = document.getElementById('search-input');
    this.itemsPerPageSelect = document.getElementById('items-per-page');

    logger.log('Elements found:', {
      tableBody: !!this.tableBody,
      paginationControls: !!this.paginationControls,
      searchInput: !!this.searchInput,
      itemsPerPageSelect: !!this.itemsPerPageSelect
    });

    this.loadData();
  }

  loadData() {
    logger.log('=== LOADING TABLE DATA ===');

    const callsDataElement = document.getElementById('calls-data');
    if (!callsDataElement) {
      logger.error('calls-data element not found');
      this.showNoDataMessage();
      return;
    }

    try {
      logger.log('Raw data:', callsDataElement.dataset.calls);

      this.calls = JSON.parse(callsDataElement.dataset.calls || '[]');
      this.filteredCalls = [...this.calls];

      logger.log('Loaded calls:', this.calls.length);
      logger.log('Sample call:', this.calls.length > 0 ? this.calls[0] : 'No calls');

      // Если данных нет, создаем тестовые
      if (this.calls.length === 0) {
        logger.log('Creating test data...');
        this.createTestData();
      }

      // Сортировка по умолчанию
      this.sortData();
      this.renderTable();
      this.setupEventListeners();

    } catch (error) {
      logger.error('Error loading table data:', error);
      this.showNoDataMessage();
    }
  }

  createTestData() {
    this.calls = [
      {
        startTime: new Date().toISOString(),
        clientNumber: '+79001234567',
        waitTime: 30,
        duration: 120,
        status: 'completed_by_agent',
        recordingFile: 'test-recording.mp3',
        callId: 'test-1'
      },
      {
        startTime: new Date(Date.now() - 3600000).toISOString(),
        clientNumber: '+79009876543',
        waitTime: 15,
        duration: 0,
        status: 'abandoned',
        recordingFile: null,
        callId: 'test-2'
      },
      {
        startTime: new Date(Date.now() - 7200000).toISOString(),
        clientNumber: '+79005554433',
        waitTime: 45,
        duration: 180,
        status: 'completed_by_agent',
        recordingFile: 'test-recording2.mp3',
        callId: 'test-3'
      }
    ];
    this.filteredCalls = [...this.calls];
    logger.log('Test data created:', this.calls.length, 'calls');
  }

  showNoDataMessage() {
    if (this.tableBody) {
      this.tableBody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Нет данных для отображения</td></tr>';
    }
  }

  setupEventListeners() {
    logger.log('Setting up event listeners...');

    // Сортировка
    document.querySelectorAll('[data-sort]').forEach(header => {
      header.addEventListener('click', () => {
        const field = header.dataset.sort;
        this.sortBy(field);
      });
    });

    // Поиск
    if (this.searchInput) {
      this.searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase();
        this.filterData();
        this.currentPage = 1;
        this.renderTable();
      });
    }

    // Количество элементов на странице
    if (this.itemsPerPageSelect) {
      this.itemsPerPageSelect.addEventListener('change', (e) => {
        this.itemsPerPage = parseInt(e.target.value);
        this.currentPage = 1;
        this.renderTable();
      });
    }
  }

  sortBy(field) {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = 'asc';
    }

    this.sortData();
    this.renderTable();
  }

  sortData() {
    this.filteredCalls.sort((a, b) => {
      let aVal = this.getSortValue(a, this.sortField);
      let bVal = this.getSortValue(b, this.sortField);

      if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  getSortValue(call, field) {
    switch (field) {
      case 'date':
        // Строки формата YYYY-MM-DD HH:MM:SS сортируются корректно
        return (call.startTime || '').toString();
      case 'time':
        // Строки формата YYYY-MM-DD HH:MM:SS сортируются корректно
        return (call.startTime || '').toString();
      case 'client':
        return call.clientNumber || '';
      case 'wait':
        return call.waitTime || 0;
      case 'duration':
        return call.duration || 0;
      case 'status':
        return call.status || '';
      default:
        return '';
    }
  }

  filterData() {
    if (!this.searchTerm) {
      this.filteredCalls = [...this.calls];
      return;
    }

    this.filteredCalls = this.calls.filter(call => {
      const searchLower = this.searchTerm.toLowerCase();
      return (
        (call.clientNumber || '').toLowerCase().includes(searchLower) ||
        (call.status || '').toLowerCase().includes(searchLower)
      );
    });
  }

  renderTable() {
    logger.log('=== RENDER TABLE ===');
    logger.log('Total calls:', this.calls.length, 'Filtered:', this.filteredCalls.length);

    if (this.filteredCalls.length === 0) {
      this.showNoDataMessage();
      this.renderPagination();
      this.updateInfo();
      return;
    }

    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageData = this.filteredCalls.slice(startIndex, endIndex);

    logger.log('Page data length:', pageData.length);

    // Создаем HTML для строк
    const rowsHTML = pageData.map(call => this.createTableRow(call)).join('');

    if (this.tableBody) {
      this.tableBody.innerHTML = rowsHTML;
      
      // Инициализация современных audio плееров после создания таблицы
      setTimeout(() => {
        if (window.initializeModernAudioPlayers) {
          window.initializeModernAudioPlayers();
        }
      }, 50);
    }

    this.renderPagination();
    this.updateInfo();
  }

  createTableRow(call) {
    const formatDateTime = (dateString) => {
      if (!dateString) return '-';
      // Извлекаем дату и время напрямую из строки (данные уже в локальном времени)
      const str = dateString.toString();
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2}):?(\d{2})?/);
      if (match) {
        return `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}:${match[6] || '00'}`;
      }
      return str;
    };

    const formatDuration = (seconds) => {
      if (!seconds) return '0 сек';
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return mins > 0 ? `${mins} мин ${secs} сек` : `${secs} сек`;
    };

    const statusText = call.status === 'abandoned' ? 'Пропущен' : 'Принят';
    const statusClass = call.status === 'abandoned' ? 'status-error' : 'status-success';

    return `
      <tr>
        <td>${formatDateTime(call.startTime)}</td>
        <td>${call.clientNumber || '-'}</td>
        <td>${call.waitTime || 0} сек</td>
        <td>${formatDuration(call.duration)}</td>
        <td><span class="badge ${statusClass}">${statusText}</span></td>
        <td class="audio-cell" data-recording="${call.recordingFile || ''}" data-status="${call.status || ''}">
          ${(() => {
            if (!call.recordingFile || call.recordingFile === '' || call.status === 'abandoned') {
              return '<span class="no-recording">Нет записи</span>';
            }
            return '<span class="audio-loading">Загрузка плеера...</span>';
          })()}
        </td>
      </tr>
    `;
  }

  renderPagination() {
    if (!this.paginationControls) return;

    const totalPages = Math.ceil(this.filteredCalls.length / this.itemsPerPage);

    if (totalPages <= 1) {
      this.paginationControls.innerHTML = '';
      return;
    }

    let paginationHTML = '<div class="pagination">';

    // Кнопка "В начало"
    if (this.currentPage > 1) {
      paginationHTML += `<button class="page-btn" data-page="1">«</button>`;
    }

    // Предыдущая страница
    if (this.currentPage > 1) {
      paginationHTML += `<button class="page-btn" data-page="${this.currentPage - 1}">‹</button>`;
    }

    // Номера страниц
    const startPage = Math.max(1, this.currentPage - 2);
    const endPage = Math.min(totalPages, this.currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
      const activeClass = i === this.currentPage ? ' active' : '';
      paginationHTML += `<button class="page-btn${activeClass}" data-page="${i}">${i}</button>`;
    }

    // Следующая страница
    if (this.currentPage < totalPages) {
      paginationHTML += `<button class="page-btn" data-page="${this.currentPage + 1}">›</button>`;
    }

    // Кнопка "В конец"
    if (this.currentPage < totalPages) {
      paginationHTML += `<button class="page-btn" data-page="${totalPages}">»</button>`;
    }

    paginationHTML += '</div>';
    this.paginationControls.innerHTML = paginationHTML;

    // Обработчики событий
    this.paginationControls.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const page = parseInt(e.target.dataset.page);
        if (page && page !== this.currentPage && page >= 1 && page <= totalPages) {
          this.currentPage = page;
          this.renderTable();
        }
      });
    });
  }

  updateInfo() {
    const infoElement = document.getElementById('table-info');
    if (infoElement) {
      const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
      const endItem = Math.min(this.currentPage * this.itemsPerPage, this.filteredCalls.length);
      infoElement.textContent = `Показано ${startItem}-${endItem} из ${this.filteredCalls.length} записей`;
    }
  }
}

// ===================== ИНИЦИАЛИЗАЦИЯ =====================

document.addEventListener('DOMContentLoaded', function() {
  logger.log('=== PAGE INITIALIZATION ===');

  // Инициализируем график
  const chartManager = new ChartManager();
  const chartDataElement = document.getElementById('chart-data');
  if (chartDataElement) {
    try {
      const chartData = JSON.parse(chartDataElement.dataset.chart || '{}');
      chartManager.createChart(chartData);
    } catch (error) {
      logger.error('Chart initialization error:', error);
      chartManager.showPlaceholder(document.getElementById('chart-container'), 'Ошибка загрузки графика');
    }
  }

  // Инициализируем таблицу
  logger.log('Initializing table...');
  window.tableManager = new CallsTableManager();

  logger.log('Page initialization complete');
});