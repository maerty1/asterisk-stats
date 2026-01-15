// Тест функции getRecordingLink
console.log('=== CHART.JS LOADED ===');
console.log('Testing getRecordingLink:');
const testFile = 'in-8412450020-79022036068-20251213-151913-1765628353.31074.mp3';
const testLink = `/recordings/${testFile.split('-')[3].substring(0, 4)}/${testFile.split('-')[3].substring(4, 6)}/${testFile.split('-')[3].substring(6, 8)}?file=${encodeURIComponent(testFile)}`;
console.log('Expected URL:', testLink);
console.log('Current timestamp:', Date.now());

// Класс для управления графиками
class ChartManager {
  constructor() {
    this.chart = null;
    this.currentType = 'bar';
    this.init();
  }

  init() {
    // График всегда в одном типе - столбцы
  }

  updateChartType() {
    if (!this.chart) return;

    const config = this.chart.config;
    config.type = this.currentType;

    // Обновляем опции для разных типов графиков
    if (this.currentType === 'line') {
      config.options.elements = {
        line: {
          tension: 0.4,
          borderWidth: 3
        },
        point: {
          radius: 5,
          hoverRadius: 8
        }
      };
      config.options.scales.x.grid = { display: false };
      config.options.scales.y.grid = { display: true };
    } else {
      config.options.elements = {
        bar: {
          borderRadius: 4,
          borderSkipped: false
        }
      };
    }

    // Обновляем график
    this.chart.update('active');
  }

  showLoading() {
    const loading = document.getElementById('chart-loading');
    if (loading) {
      loading.classList.remove('d-none');
    }
  }

  hideLoading() {
    const loading = document.getElementById('chart-loading');
    if (loading) {
      loading.classList.add('d-none');
    }
  }

  setChart(chartInstance) {
    this.chart = chartInstance;
  }
}

// Глобальный менеджер графиков
const chartManager = new ChartManager();

// Система уведомлений
class NotificationManager {
  constructor() {
    this.container = document.getElementById('toast-container');
    this.toasts = [];
  }

  show(message, type = 'info', duration = 5000) {
    const id = Date.now();
    const toast = this.createToast(id, message, type);

    this.container.appendChild(toast);
    this.toasts.push({ id, element: toast });

    // Показываем уведомление
    setTimeout(() => {
      toast.classList.add('show');
    }, 10);

    // Автоматически скрываем через указанное время
    if (duration > 0) {
      setTimeout(() => {
        this.hide(id);
      }, duration);
    }

    return id;
  }

  createToast(id, message, type) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');

    const header = document.createElement('div');
    header.className = 'toast-header';

    const title = document.createElement('strong');
    title.className = 'me-auto';
    title.textContent = this.getTitle(type);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close';
    closeBtn.setAttribute('aria-label', 'Закрыть');
    closeBtn.innerHTML = '×';
    closeBtn.onclick = () => this.hide(id);

    header.appendChild(title);
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'toast-body';
    body.textContent = message;

    toast.appendChild(header);
    toast.appendChild(body);

    return toast;
  }

  getTitle(type) {
    const titles = {
      success: 'Успех',
      error: 'Ошибка',
      warning: 'Предупреждение',
      info: 'Информация'
    };
    return titles[type] || 'Уведомление';
  }

  hide(id) {
    const toastData = this.toasts.find(t => t.id === id);
    if (!toastData) return;

    const toast = toastData.element;
    toast.classList.add('hide');

    // Удаляем из DOM после анимации
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);

    // Удаляем из массива
    this.toasts = this.toasts.filter(t => t.id !== id);
  }

  hideAll() {
    this.toasts.forEach(toast => this.hide(toast.id));
  }
}

// Глобальный менеджер уведомлений
const notificationManager = new NotificationManager();

// Анимации и эффекты
class AnimationManager {
  constructor() {
    this.init();
  }

  init() {
    this.addIntersectionObserver();
    this.addLoadingStates();
  }

  addIntersectionObserver() {
    // Анимация появления элементов при скролле
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('fade-in-up');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    // Наблюдаем за элементами, которые должны анимироваться
    document.querySelectorAll('.stat-card, .chart-container, .table-responsive').forEach(el => {
      observer.observe(el);
    });
  }

  addLoadingStates() {
    // Добавляем плавные переходы для всех интерактивных элементов
    document.querySelectorAll('button, .btn, input, select').forEach(el => {
      el.addEventListener('mousedown', () => {
        el.style.transform = 'scale(0.98)';
      });

      el.addEventListener('mouseup', () => {
        el.style.transform = '';
      });

      el.addEventListener('mouseleave', () => {
        el.style.transform = '';
      });
    });
  }

  showSkeletonLoader(container, type = 'cards') {
    container.innerHTML = '';

    if (type === 'cards') {
      for (let i = 0; i < 4; i++) {
        const skeletonCard = document.createElement('div');
        skeletonCard.className = 'stat-card skeleton-card skeleton';
        container.appendChild(skeletonCard);
      }
    } else if (type === 'table') {
      for (let i = 0; i < 5; i++) {
        const skeletonRow = document.createElement('div');
        skeletonRow.className = 'skeleton-table-row skeleton';
        container.appendChild(skeletonRow);
      }
    }
  }

  hideSkeletonLoader(container) {
    // Заменяем skeleton на реальный контент с анимацией
    container.style.opacity = '0';
    setTimeout(() => {
      container.style.transition = 'opacity 0.3s ease';
      container.style.opacity = '1';
    }, 100);
  }

  animateElement(element, animation = 'bounce') {
    element.classList.add(animation);
    setTimeout(() => {
      element.classList.remove(animation);
    }, 1000);
  }

  animateCounters() {
    // Анимируем счетчики в карточках статистики
    const counters = document.querySelectorAll('.stat-value[data-counter]');
    counters.forEach(counter => {
      const target = parseInt(counter.getAttribute('data-counter'));
      if (isNaN(target)) return;

      this.animateCounter(counter, 0, target, 1000);
    });
  }

  animateCounter(element, start, end, duration) {
    const startTime = performance.now();

    const updateCounter = (currentTime) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Используем easeOut функцию для плавной анимации
      const easeOut = 1 - Math.pow(1 - progress, 3);
      const current = Math.floor(start + (end - start) * easeOut);

      element.textContent = current.toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(updateCounter);
      }
    };

    requestAnimationFrame(updateCounter);
  }

  createRippleEffect(event) {
    const button = event.currentTarget;
    const circle = document.createElement('span');
    const diameter = Math.max(button.clientWidth, button.clientHeight);
    const radius = diameter / 2;

    circle.style.width = circle.style.height = `${diameter}px`;
    circle.style.left = `${event.clientX - button.offsetLeft - radius}px`;
    circle.style.top = `${event.clientY - button.offsetTop - radius}px`;
    circle.classList.add('ripple-effect');

    const ripple = button.getElementsByClassName('ripple-effect')[0];
    if (ripple) {
      ripple.remove();
    }

    button.appendChild(circle);
  }
}

// Глобальный менеджер анимаций
const animationManager = new AnimationManager();

// Функция для отображения загрузочного состояния
function showLoadingState(form) {
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalText = submitBtn.innerHTML;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Формирование...';

  // Возвращаем функцию для восстановления состояния
  return () => {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  };
}

// Обработка формы с загрузочным состоянием
function initializeFormHandler() {
  const form = document.querySelector('form[action="/report"]');
  if (!form) return;

  form.addEventListener('submit', function(e) {
    const restoreButton = showLoadingState(this);
    notificationManager.show('Формирование отчета...', 'info', 2000);
  });
}

// Функция экспорта данных
function initializeExportButtons() {
  // Добавляем кнопку экспорта CSV если есть данные
  const resultsSection = document.querySelector('.card-body');
  if (!resultsSection || !document.getElementById('chart-data')) return;

  const exportContainer = document.createElement('div');
  exportContainer.className = 'd-flex justify-content-end mb-3';
  exportContainer.innerHTML = `
    <div class="btn-group" role="group" aria-label="Экспорт данных">
      <button type="button" class="btn btn-outline-primary btn-sm" id="export-csv" aria-describedby="export-help">
        <i class="bi bi-file-earmark-spreadsheet me-1" aria-hidden="true"></i>Экспорт CSV
      </button>
      <button type="button" class="btn btn-outline-secondary btn-sm" id="export-json" aria-describedby="export-help">
        <i class="bi bi-file-earmark-code me-1" aria-hidden="true"></i>Экспорт JSON
      </button>
    </div>
    <div id="export-help" class="sr-only">Кнопки для экспорта данных отчета в различных форматах</div>
  `;

  // Вставляем после формы
  const form = resultsSection.querySelector('form');
  if (form) {
    form.insertAdjacentElement('afterend', exportContainer);
  }

  // Обработчики экспорта
  document.getElementById('export-csv')?.addEventListener('click', () => exportToCSV());
  document.getElementById('export-json')?.addEventListener('click', () => exportToJSON());
}

function exportToCSV() {
  try {
    const chartDataElement = document.getElementById('chart-data');
    if (!chartDataElement) {
      notificationManager.show('Нет данных для экспорта', 'warning');
      return;
    }

    const data = JSON.parse(chartDataElement.dataset.chart);
    if (!data.calls || data.calls.length === 0) {
      notificationManager.show('Нет данных для экспорта', 'warning');
      return;
    }

    // Создаем CSV
    const headers = ['Дата', 'Время', 'Клиент', 'Ожидание (сек)', 'Длительность', 'Статус'];
    const csvContent = [
      headers.join(','),
      ...data.calls.map(call => {
        // Для исходящих звонков показываем destination (длинный номер)
        // Используем флаг isOutbound из данных сервера
        const rawNumber = call.isOutbound && call.destination 
          ? (call.destination || call.clientNumber || '-') 
          : (call.clientNumber || '-');
        
        // Форматируем номер (убираем +7 или 7 в начале)
        const formatPhoneNumber = (number) => {
          if (!number || number === '-') return number;
          const num = number.toString().trim();
          if (num.startsWith('+7')) {
            return num.substring(2);
          }
          if (num.startsWith('7') && num.length > 10) {
            return num.substring(1);
          }
          return num;
        };
        const displayNumber = formatPhoneNumber(rawNumber);
        
        // Извлекаем дату и время напрямую из строки (данные уже в локальном времени)
        const dateMatch = (call.startTime || '').toString().match(/(\d{4})-(\d{2})-(\d{2})/);
        const timeMatch = (call.startTime || '').toString().match(/(\d{2}):(\d{2})/);
        const dateStr = dateMatch ? `${dateMatch[3]}.${dateMatch[2]}.${dateMatch[1]}` : '';
        const timeStr = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : '';
        
        return [
          dateStr,
          timeStr,
          displayNumber,
          call.waitTime || 0,
          call.duration || 0,
          call.status === 'abandoned' ? 'Пропущен' : 'Принят'
        ].map(field => `"${field}"`).join(',');
      })
    ].join('\n');

    downloadFile(csvContent, 'asterisk-report.csv', 'text/csv');
    notificationManager.show('Данные успешно экспортированы в CSV', 'success');
  } catch (error) {
    console.error('Ошибка экспорта CSV:', error);
    alert('Ошибка при экспорте CSV');
  }
}

function exportToJSON() {
  try {
    const chartDataElement = document.getElementById('chart-data');
    if (!chartDataElement) {
      notificationManager.show('Нет данных для экспорта', 'warning');
      return;
    }

    const data = JSON.parse(chartDataElement.dataset.chart);
    const jsonContent = JSON.stringify(data, null, 2);

    downloadFile(jsonContent, 'asterisk-report.json', 'application/json');
    notificationManager.show('Данные успешно экспортированы в JSON', 'success');
  } catch (error) {
    console.error('Ошибка экспорта JSON:', error);
    alert('Ошибка при экспорте JSON');
  }
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);

  // Добавляем анимацию перед скачиванием
  a.click();

  // Анимируем кнопку экспорта
  const exportButtons = document.querySelectorAll('#export-csv, #export-json');
  exportButtons.forEach(btn => {
    animationManager.animateElement(btn, 'bounce');
  });

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Класс для управления таблицей звонков
class CallsTableManager {
  constructor() {
    this.calls = [];
    this.filteredCalls = [];
    this.currentPage = 1;
    this.itemsPerPage = 25;
    this.sortField = null;
    this.sortDirection = 'asc';
    this.searchTerm = '';

    // Новые свойства для фильтров
    this.filters = {
      status: '',
      duration: '',
      time: ''
    };

    this.tableBody = document.getElementById('calls-tbody');
    this.paginationControls = document.getElementById('pagination-controls');
    this.paginationInfo = document.getElementById('pagination-info');
    this.tableInfo = document.getElementById('table-info'); // Может отсутствовать
    this.itemsPerPageSelect = document.getElementById('items-per-page');
    this.searchInput = document.getElementById('table-search');
    
    // Проверка обязательных элементов
    if (!this.tableBody || !this.paginationControls || !this.paginationInfo || !this.itemsPerPageSelect || !this.searchInput) {
      console.error('Не все обязательные элементы таблицы найдены:', {
        tableBody: !!this.tableBody,
        paginationControls: !!this.paginationControls,
        paginationInfo: !!this.paginationInfo,
        itemsPerPageSelect: !!this.itemsPerPageSelect,
        searchInput: !!this.searchInput
      });
      // Не прерываем инициализацию, если элементы не найдены - возможно они появятся позже
    }

    // Небольшая задержка для гарантии, что DOM полностью загружен
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => this.initialize(), 100);
      });
    } else {
      setTimeout(() => this.initialize(), 100);
    }
  }

  initialize() {
    // Загружаем данные
    const callsDataElement = document.getElementById('calls-data');
    if (!callsDataElement) {
      console.warn('calls-data element not found - таблица не будет заполнена');
      // Показываем сообщение об отсутствии данных
      if (this.tableBody) {
        this.tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Нет данных для отображения</td></tr>';
      }
      return;
    }

    // Проверяем наличие обязательных элементов
    if (!this.tableBody) {
      console.error('tableBody не найден');
      return;
    }

    // Очищаем tbody, если там уже есть данные от EJS
    if (this.tableBody && this.tableBody.children.length > 0) {
      console.log('Очищаем существующие данные из tbody');
      this.tableBody.innerHTML = '';
    }

    try {
      const callsData = callsDataElement.dataset.calls;
      if (!callsData) {
        console.warn('calls-data не содержит данных');
        if (this.tableBody) {
          this.tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Нет данных для отображения</td></tr>';
        }
        return;
      }

      this.calls = JSON.parse(callsData);
      this.filteredCalls = [...this.calls];
      
      console.log('✅ Данные загружены. Всего звонков:', this.calls.length);
      
      // Отладка: проверяем наличие recordingFile
      const callsWithRecording = this.calls.filter(c => c.recordingFile);
      console.log('Звонков с записью:', callsWithRecording.length);
      if (callsWithRecording.length > 0) {
        console.log('Пример записи:', callsWithRecording[0].recordingFile);
      }
      
      if (this.calls.length === 0) {
        console.warn('Массив звонков пуст');
        if (this.tableBody) {
          this.tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Нет звонков для отображения</td></tr>';
        }
        return;
      }

      this.setupEventListeners();
      this.renderTable();
    } catch (error) {
      console.error('Ошибка загрузки данных таблицы:', error);
      console.error('Детали ошибки:', error.message, error.stack);
      if (this.tableBody) {
        this.tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--md-sys-color-error);">Ошибка загрузки данных: ${error.message}</td></tr>`;
      }
    }
  }

  setupEventListeners() {
    // Сортировка
    document.querySelectorAll('.sortable').forEach(header => {
      header.addEventListener('click', () => {
        const field = header.dataset.sort;
        this.sortBy(field);
      });
    });

    // Изменение количества элементов на странице
    this.itemsPerPageSelect.addEventListener('change', (e) => {
      this.itemsPerPage = parseInt(e.target.value);
      this.currentPage = 1;
      this.renderTable();
    });

    // Поиск
    this.searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.toLowerCase();
      this.filterData();
      this.currentPage = 1;
      this.renderTable();
    });


  }

  sortBy(field) {
    if (this.sortField === field) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortField = field;
      this.sortDirection = 'asc';
    }

    // Обновляем иконки сортировки
    document.querySelectorAll('.sortable').forEach(header => {
      header.classList.remove('sort-asc', 'sort-desc');
    });

    const currentHeader = document.querySelector(`[data-sort="${field}"]`);
    currentHeader.classList.add(`sort-${this.sortDirection}`);

    this.sortData();
    this.renderTable();
  }

  sortData() {
    this.filteredCalls.sort((a, b) => {
      let aVal, bVal;

      switch (this.sortField) {
        case 'date':
          // Строки формата YYYY-MM-DD сортируются корректно как строки
          aVal = (a.startTime || '').toString();
          bVal = (b.startTime || '').toString();
          break;
        case 'time':
          // Строки формата YYYY-MM-DD HH:MM:SS сортируются корректно как строки
          aVal = (a.startTime || '').toString();
          bVal = (b.startTime || '').toString();
          break;
        case 'client':
          aVal = (a.clientNumber || '').toLowerCase();
          bVal = (b.clientNumber || '').toLowerCase();
          break;
        case 'wait':
          aVal = a.waitTime || 0;
          bVal = b.waitTime || 0;
          break;
        case 'duration':
          aVal = a.duration || 0;
          bVal = b.duration || 0;
          break;
        case 'status':
          aVal = a.status;
          bVal = b.status;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }

  filterData() {
    this.filteredCalls = [...this.calls];

    // Применяем поиск
    if (this.searchTerm) {
      this.filteredCalls = this.filteredCalls.filter(call => {
        // Для поиска используем оба номера (clientNumber и destination)
        // Используем флаг isOutbound из данных сервера
        const displayNumber = call.isOutbound && call.destination 
          ? (call.destination || call.clientNumber || '') 
          : (call.clientNumber || '');
        
        const searchFields = [
          call.clientNumber || '',
          call.destination || '',
          displayNumber,
          call.status === 'abandoned' ? 'пропущен' : 'принят',
          call.status,
          call.startTime || '',
          call.endTime || ''
        ];

        return searchFields.some(field =>
          field.toLowerCase().includes(this.searchTerm)
        );
      });
    }

    // Применяем фильтры статуса
    if (this.filters.status) {
      this.filteredCalls = this.filteredCalls.filter(call => call.status === this.filters.status);
    }

    // Применяем фильтр длительности
    if (this.filters.duration) {
      this.filteredCalls = this.filteredCalls.filter(call => {
        const duration = call.duration || 0;
        switch (this.filters.duration) {
          case 'short':
            return duration < 30;
          case 'medium':
            return duration >= 30 && duration <= 300;
          case 'long':
            return duration > 300;
          default:
            return true;
        }
      });
    }

    // Применяем фильтр времени
    if (this.filters.time) {
      this.filteredCalls = this.filteredCalls.filter(call => {
        if (!call.startTime) return false;

        // Извлекаем часы напрямую из строки (данные уже в локальном времени)
        const str = call.startTime.toString();
        const match = str.match(/(\d{2}):(\d{2})/);
        if (!match) return false;
        const hours = parseInt(match[1], 10);

        switch (this.filters.time) {
          case 'morning':
            return hours >= 6 && hours < 12;
          case 'afternoon':
            return hours >= 12 && hours < 18;
          case 'evening':
            return hours >= 18 && hours < 24;
          case 'night':
            return hours >= 0 && hours < 6;
          default:
            return true;
        }
      });
    }
  }


  renderTable() {
    if (!this.tableBody) {
      console.error('renderTable: tableBody не найден');
      return;
    }

    if (!this.calls || this.calls.length === 0) {
      console.warn('renderTable: нет данных для отображения');
      this.tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Нет звонков для отображения</td></tr>';
      this.updateInfo();
      return;
    }

    console.log('renderTable вызвана, calls:', this.calls.length, 'filteredCalls:', this.filteredCalls.length);
    const startIndex = (this.currentPage - 1) * this.itemsPerPage;
    const endIndex = startIndex + this.itemsPerPage;
    const pageData = this.filteredCalls.slice(startIndex, endIndex);
    console.log('pageData length:', pageData.length);

    if (pageData.length === 0) {
      this.tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem;">Нет данных, соответствующих фильтрам</td></tr>';
      this.updateInfo();
      return;
    }

    // Показываем skeleton loading на короткое время для плавности
    const wasEmpty = this.tableBody.children.length === 0;
    if (wasEmpty && pageData.length > 0) {
      animationManager.showSkeletonLoader(this.tableBody, 'table');
      setTimeout(() => {
        this.tableBody.innerHTML = pageData.map(call => this.createTableRow(call)).join('');

        // Инициализация audio элементов после создания таблицы
        this.initializeAudioPlayers();

        // Добавляем анимацию появления
        Array.from(this.tableBody.children).forEach((row, index) => {
          row.style.opacity = '0';
          row.style.transform = 'translateY(10px)';
          setTimeout(() => {
            row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
            row.style.opacity = '1';
            row.style.transform = 'translateY(0)';
          }, index * 50);
        });
      }, 200);
    } else {
      this.tableBody.innerHTML = pageData.map(call => this.createTableRow(call)).join('');

      // Инициализация audio элементов после создания таблицы
      this.initializeAudioPlayers();
    }

    this.renderPagination();
    this.updateInfo();
  }

  initializeAudioPlayers() {
    console.log('initializeAudioPlayers вызвана');
    // Находим все ячейки с аудио
    const audioCells = this.tableBody.querySelectorAll('td.audio-cell[data-recording]');
    console.log('Найдено audio ячеек:', audioCells.length);

    audioCells.forEach((cell, index) => {
      console.log('Обрабатываем ячейку', index, 'с recording:', cell.getAttribute('data-recording'));
      const recordingFile = cell.getAttribute('data-recording');
      const status = cell.getAttribute('data-status');
      
      // Пропускаем если нет записи или звонок не принят
      // Показываем записи для: answered, completed_by_agent, completed_by_caller
      const validStatuses = ['answered', 'completed_by_agent', 'completed_by_caller'];
      if (!recordingFile || !validStatuses.includes(status)) {
        return;
      }
      
      // Формируем URL
      const getRecordingLink = (recordingFile) => {
        if (!recordingFile) return null;
        const parts = recordingFile.split('-');
        if (parts.length < 4) {
          console.error('getRecordingLink: invalid filename format:', recordingFile);
          return null;
        }
        const datePart = parts[3];
        if (!datePart || datePart.length !== 8) {
          console.error('getRecordingLink: invalid date part:', datePart, 'in file:', recordingFile);
          return null;
        }
        const year = datePart.substring(0, 4);
        const month = datePart.substring(4, 6);
        const day = datePart.substring(6, 8);
        return `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
      };
      
      const recordingUrl = getRecordingLink(recordingFile);
      if (!recordingUrl) {
        console.error('Не удалось сформировать URL для:', recordingFile);
        cell.innerHTML = '<span class="text-danger small">Ошибка URL</span>';
        return;
      }

      console.log('Создаю audio элемент для:', recordingFile, 'URL:', recordingUrl);
      console.log('Проверяем URL формат:', recordingUrl.match(/^\/recordings\/\d{4}\/\d{2}\/\d{2}\?file=.+$/));
      
      // Создаем audio элемент через DOM API
      const audio = document.createElement('audio');
      audio.setAttribute('controls', 'true');
      audio.setAttribute('preload', 'metadata');
      audio.setAttribute('crossorigin', 'anonymous');
      audio.className = 'audio-player';
      audio.setAttribute('data-recording', recordingFile);
      
      // Убеждаемся, что controls включены
      audio.controls = true;
      audio.preload = 'metadata';
      
      const source = document.createElement('source');
      source.src = recordingUrl;
      source.type = 'audio/mpeg';
      audio.appendChild(source);
      
      // Добавляем fallback текст
      const fallbackText = document.createTextNode('Ваш браузер не поддерживает воспроизведение аудио.');
      audio.appendChild(fallbackText);
      
      // Обработка ошибок загрузки
      audio.addEventListener('error', (e) => {
        console.error('Ошибка загрузки аудио:', recordingUrl, audio.error);
        const error = audio.error;
        let errorMsg = 'Ошибка загрузки';
        if (error) {
          switch(error.code) {
            case error.MEDIA_ERR_ABORTED:
              errorMsg = 'Загрузка прервана';
              break;
            case error.MEDIA_ERR_NETWORK:
              errorMsg = 'Ошибка сети';
              break;
            case error.MEDIA_ERR_DECODE:
              errorMsg = 'Ошибка декодирования';
              break;
            case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
              errorMsg = 'Формат не поддерживается';
              break;
          }
        }
        
        // Показываем сообщение об ошибке
        const errorSpan = document.createElement('span');
        errorSpan.className = 'text-danger small d-block mt-1';
        errorSpan.textContent = errorMsg;
        cell.appendChild(errorSpan);
      });

      // Обработка успешной загрузки метаданных
      audio.addEventListener('loadedmetadata', () => {
        console.log('Метаданные загружены для:', recordingUrl);
      });

      // Обработка начала загрузки
      audio.addEventListener('loadstart', () => {
        console.log('Начало загрузки:', recordingUrl);
      });

      // Обработка готовности к воспроизведению
      audio.addEventListener('canplay', () => {
        console.log('Аудио готово к воспроизведению:', recordingUrl);
        // Убеждаемся, что controls активны
        audio.controls = true;
      });
      
      // Обработка полной готовности к воспроизведению
      audio.addEventListener('canplaythrough', () => {
        console.log('Аудио полностью готово к воспроизведению:', recordingUrl);
        audio.controls = true;
      });
      
      // Обработка загрузки данных
      audio.addEventListener('progress', () => {
        if (audio.buffered.length > 0) {
          const bufferedEnd = audio.buffered.end(audio.buffered.length - 1);
          const duration = audio.duration;
          if (duration > 0) {
            const percentLoaded = (bufferedEnd / duration) * 100;
            console.log('Загружено:', percentLoaded.toFixed(1) + '%');
          }
        }
      });

      // Обработка проблем с загрузкой
      audio.addEventListener('stalled', () => {
        console.warn('Загрузка аудио остановлена:', recordingUrl);
      });

      // Заменяем содержимое ячейки на audio элемент
      cell.innerHTML = '';
      cell.appendChild(audio);
      
      // Проверяем готовность элемента
      console.log('Audio элемент создан:', {
        src: source.src,
        readyState: audio.readyState,
        networkState: audio.networkState,
        controls: audio.controls
      });
      
      // Принудительно загружаем метаданные
      try {
        // Устанавливаем источник напрямую для надежности
        audio.src = recordingUrl;
        
        // Убеждаемся, что controls включены перед загрузкой
        audio.controls = true;
        audio.setAttribute('controls', 'true');
        
        // Загружаем метаданные
        audio.load();
        
        // Проверяем через небольшую задержку
        setTimeout(() => {
          console.log('Состояние audio после загрузки:', {
            readyState: audio.readyState,
            networkState: audio.networkState,
            error: audio.error,
            paused: audio.paused,
            duration: audio.duration,
            controls: audio.controls,
            canPlay: audio.readyState >= 2 // HAVE_CURRENT_DATA
          });
          
          // Если есть ошибка, показываем её
          if (audio.error) {
            console.error('Ошибка audio элемента:', audio.error);
            const errorMsg = document.createElement('span');
            errorMsg.className = 'text-danger small d-block mt-1';
            errorMsg.textContent = 'Ошибка загрузки: ' + audio.error.message;
            cell.appendChild(errorMsg);
          } else if (audio.readyState >= 2) {
            // Метаданные загружены, кнопка play должна быть активна
            console.log('Метаданные загружены, кнопка play должна быть активна');
            audio.controls = true;
          }
        }, 1000);
      } catch (e) {
        console.error('Ошибка при загрузке audio элемента:', e);
        cell.innerHTML = '<span class="text-danger small">Ошибка инициализации: ' + e.message + '</span>';
      }
    });
  }

  createTableRow(call) {
    // Функции форматирования без преобразования таймзоны (данные уже в локальном времени)
    const formatDate = (dateString) => {
      if (!dateString) return '';
      const str = dateString.toString();
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (match) return `${match[3]}.${match[2]}.${match[1]}`;
      return str;
    };

    const formatTime = (dateString) => {
      if (!dateString) return '';
      const str = dateString.toString();
      const match = str.match(/(\d{2}):(\d{2})/);
      if (match) return `${match[1]}:${match[2]}`;
      return str;
    };

    const formatDuration = (seconds) => {
      if (!seconds) return '0 сек';
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      if (mins > 0) {
        return `${mins} мин ${secs} сек`;
      }
      return `${secs} сек`;
    };

    const formatPhoneNumber = (number) => {
      if (!number) return '-';
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

    const getRecordingLink = (recordingFile) => {
      if (!recordingFile) {
        return null;
      }

      const parts = recordingFile.split('-');
      if (parts.length < 4) {
        console.error('getRecordingLink: invalid filename format:', recordingFile);
        return null;
      }

      const datePart = parts[3];
      if (!datePart || datePart.length !== 8) {
        console.error('getRecordingLink: invalid date part:', datePart, 'in file:', recordingFile);
        return null;
      }

      const year = datePart.substring(0, 4);
      const month = datePart.substring(4, 6);
      const day = datePart.substring(6, 8);

      const url = `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
      console.log('Generated recording URL:', url, 'for file:', recordingFile);
      return url;
    };

    const formatDateTime = (dateString) => {
      if (!dateString) return '-';
      // Данные в БД уже в локальном времени - извлекаем напрямую без преобразования
      const str = dateString.toString();
      // Формат "YYYY-MM-DD HH:MM:SS" или "YYYY-MM-DDTHH:MM:SS"
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})/);
      if (match) {
        return `${match[3]}.${match[2]}.${match[1]}, ${match[4]}:${match[5]}`;
      }
      // Fallback для других форматов
      return str;
    };

    const isCompleted = call.status === 'completed_by_agent' || call.status === 'completed_by_caller';
    
    // Определяем статус с учетом перезвонов и типа представления
    let statusText, statusIcon, statusClass;
    
    // Для входящих/исходящих звонков используем disposition из CDR
    if (call.status === 'answered') {
      statusText = 'Принят';
      statusIcon = '✓';
      statusClass = 'answered';
    } else if (call.status === 'no_answer') {
      statusText = 'Не отвечен';
      statusIcon = '✗';
      statusClass = 'abandoned';
    } else if (call.status === 'busy') {
      statusText = 'Занято';
      statusIcon = '⏸';
      statusClass = 'busy';
    } else if (call.status === 'failed') {
      statusText = 'Неудачно';
      statusIcon = '✗';
      statusClass = 'failed';
    } else if (isCompleted) {
      // Для очередей
      statusText = 'Обработан';
      statusIcon = '✓';
      statusClass = 'completed';
    } else if (call.callbackStatus) {
      // Статус перезвона (для очередей)
      statusText = call.callbackStatus;
      if (call.callbackStatus === 'Перезвонил сам') {
        statusIcon = '↩️';
        statusClass = 'callback-client';
      } else if (call.callbackStatus === 'Перезвонили мы') {
        statusIcon = '📞';
        statusClass = 'callback-agent';
      } else {
        statusIcon = '✗';
        statusClass = 'callback-no';
      }
    } else {
      // Для очередей - пропущен
      statusText = 'Пропущен';
      statusIcon = '✗';
      statusClass = 'abandoned';
    }

    let recordingHtml = '';
    // Показываем запись для:
    // 1. Принятых входящих/исходящих звонков (status === 'answered')
    // 2. Обработанных звонков в очередях (isCompleted)
    // 3. Перезвонов с записью (callbackStatus)
    // Для исходящих и входящих звонков запись есть, если звонок принят (answered)
    const isAnswered = call.status === 'answered';
    const hasRecording = call.recordingFile && (isAnswered || isCompleted || (call.callbackStatus && call.callbackStatus !== 'Не обработан'));
    if (hasRecording) {
      const parts = call.recordingFile.split('-');
      if (parts.length >= 4) {
        const datePart = parts[3];
        if (datePart && datePart.length === 8) {
          const year = datePart.substring(0, 4);
          const month = datePart.substring(4, 6);
          const day = datePart.substring(6, 8);
          const recordingUrl = `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(call.recordingFile)}`;
          recordingHtml = `
            <div class="audio-cell" data-recording="${call.recordingFile}" data-status="${call.status}">
              <audio controls preload="metadata">
                <source src="${recordingUrl}" type="audio/mpeg">
                Ваш браузер не поддерживает аудио элемент.
              </audio>
            </div>
          `;
        } else {
          recordingHtml = '<span style="color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">—</span>';
        }
      } else {
        recordingHtml = '<span style="color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">—</span>';
      }
    } else {
      recordingHtml = '<span style="color: var(--md-sys-color-on-surface-variant); font-size: 0.875rem;">—</span>';
    }

    const waitTime = call.waitTime || (call.queueTime ? call.queueTime : 0);
    const waitTimeText = waitTime ? `${waitTime} сек` : '-';
    const durationText = call.duration ? `${call.duration} сек` : '-';

    // Для исходящих звонков показываем destination (длинный номер), а не clientNumber (короткий)
    // Используем флаг isOutbound из данных сервера (определяется по outbound_cnum)
    const rawNumber = call.isOutbound && call.destination 
      ? (call.destination || call.clientNumber || 'Unknown') 
      : (call.clientNumber || 'Unknown');
    const displayNumber = formatPhoneNumber(rawNumber);

    return `
      <tr>
        <td>${formatDateTime(call.startTime)}</td>
        <td class="tech-metric">${displayNumber}</td>
        <td>${waitTimeText}</td>
        <td>${durationText}</td>
        <td>
          <span class="status-badge ${statusClass}">
            ${statusIcon} ${statusText}
          </span>
        </td>
        <td>${recordingHtml}</td>
      </tr>
    `;
  }

  renderPagination() {
    if (!this.paginationControls) {
      console.warn('paginationControls not found');
      return;
    }

    const totalPages = Math.ceil(this.filteredCalls.length / this.itemsPerPage);
    console.log('renderPagination: filteredCalls.length =', this.filteredCalls.length, 'itemsPerPage =', this.itemsPerPage, 'totalPages =', totalPages);

    if (totalPages <= 1) {
      this.paginationControls.innerHTML = '';
      console.log('Пагинация скрыта: всего страниц <= 1');
      return;
    }

    let paginationHtml = '<ul class="pagination-list">';

    // Предыдущая страница
    paginationHtml += `
      <li class="page-item ${this.currentPage === 1 ? 'disabled' : ''}">
        <button class="page-link" ${this.currentPage === 1 ? 'disabled' : ''} data-page="${this.currentPage - 1}" aria-label="Предыдущая страница">
          <span aria-hidden="true">&laquo;</span>
        </button>
      </li>
    `;

    // Номера страниц
    const startPage = Math.max(1, this.currentPage - 2);
    const endPage = Math.min(totalPages, this.currentPage + 2);

    // Показываем первую страницу, если не в начале
    if (startPage > 1) {
      paginationHtml += `
        <li class="page-item">
          <button class="page-link" data-page="1">1</button>
        </li>
      `;
      if (startPage > 2) {
        paginationHtml += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
      }
    }

    for (let i = startPage; i <= endPage; i++) {
      paginationHtml += `
        <li class="page-item ${i === this.currentPage ? 'active' : ''}">
          <button class="page-link" data-page="${i}">${i}</button>
        </li>
      `;
    }

    // Показываем последнюю страницу, если не в конце
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        paginationHtml += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
      }
      paginationHtml += `
        <li class="page-item">
          <button class="page-link" data-page="${totalPages}">${totalPages}</button>
        </li>
      `;
    }

    // Следующая страница
    paginationHtml += `
      <li class="page-item ${this.currentPage === totalPages ? 'disabled' : ''}">
        <button class="page-link" ${this.currentPage === totalPages ? 'disabled' : ''} data-page="${this.currentPage + 1}" aria-label="Следующая страница">
          <span aria-hidden="true">&raquo;</span>
        </button>
      </li>
    `;

    paginationHtml += '</ul>';

    this.paginationControls.innerHTML = paginationHtml;

    // Обработчики кликов
    this.paginationControls.querySelectorAll('.page-link:not(:disabled)').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = parseInt(e.currentTarget.dataset.page);
        if (page && page !== this.currentPage && page >= 1 && page <= totalPages) {
          this.currentPage = page;
          this.renderTable();
        }
      });
    });
  }

  updateInfo() {
    const totalItems = this.filteredCalls.length;
    const startItem = (this.currentPage - 1) * this.itemsPerPage + 1;
    const endItem = Math.min(startItem + this.itemsPerPage - 1, totalItems);

    this.paginationInfo.textContent = `Показаны записи ${startItem}-${endItem} из ${totalItems}`;
    if (this.tableInfo) {
      this.tableInfo.textContent = `записей (из ${this.calls.length})`;
    }
  }
}

// Управление интерфейсом
class UIManager {
  constructor() {
    this.compactMode = localStorage.getItem('compactMode') === 'true';
    this.init();
  }

  init() {
    this.applyCompactMode(this.compactMode);
    this.setupToggles();
    this.setupResponsiveBehavior();
  }

  setupResponsiveBehavior() {
    // Автоматически включаем компактный режим на маленьких экранах
    const mediaQuery = window.matchMedia('(max-width: 767px)');

    const handleMediaChange = (e) => {
      if (e.matches && !this.compactMode) {
        // На маленьких экранах автоматически включаем компактный режим
        this.applyCompactMode(true);
      } else if (!e.matches && this.compactMode && localStorage.getItem('compactMode') !== 'true') {
        // На больших экранах возвращаем обычный режим, если он не был явно установлен
        this.applyCompactMode(false);
      }
    };

    // Проверяем при загрузке
    handleMediaChange(mediaQuery);

    // Слушаем изменения
    mediaQuery.addEventListener('change', handleMediaChange);
  }


  applyCompactMode(compact) {
    const body = document.body;
    if (compact) {
      body.classList.add('compact-mode');
    } else {
      body.classList.remove('compact-mode');
    }

    // Обновляем иконку
    const icon = document.getElementById('view-icon');
    if (icon) {
      icon.className = compact ? 'bi bi-list' : 'bi bi-grid-3x3-gap';
    }

    localStorage.setItem('compactMode', compact);
    this.compactMode = compact;
  }


  toggleCompactMode() {
    const newMode = !this.compactMode;
    this.applyCompactMode(newMode);
    notificationManager.show(
      `Вид переключен на ${newMode ? 'компактный' : 'обычный'}`,
      'info',
      1500
    );
  }

  setupToggles() {
    const viewToggle = document.getElementById('view-toggle');

    console.log('Setting up toggles:', {
      viewToggle: !!viewToggle
    });

    if (viewToggle) {
      viewToggle.addEventListener('click', () => {
        this.toggleCompactMode();
      });
    }
  }
}

// Регистрация Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/js/sw.js')
      .then(registration => {
        console.log('Service Worker зарегистрирован:', registration);
      })
      .catch(error => {
        console.log('Ошибка регистрации Service Worker:', error);
      });
  });
}

document.addEventListener('DOMContentLoaded', function() {
  console.log('=== DOMContentLoaded fired ===');

  // Инициализируем менеджер интерфейса
  console.log('Initializing UIManager...');
  new UIManager();

  // Инициализируем обработчик формы
  initializeFormHandler();

  // Инициализируем кнопки экспорта
  initializeExportButtons();

  // Инициализируем менеджер таблицы
  console.log('Creating CallsTableManager...');
  // Проверяем наличие данных перед инициализацией
  const callsDataElement = document.getElementById('calls-data');
  if (callsDataElement) {
    console.log('calls-data элемент найден, инициализируем таблицу...');
    const tableManager = new CallsTableManager();
  } else {
    console.warn('calls-data элемент не найден - таблица не будет инициализирована');
  }

  // Анимируем счетчики статистики после небольшой задержки
  setTimeout(() => {
    animationManager.animateCounters();
  }, 500);

  // Проверяем, есть ли данные для графика
  const chartDataElement = document.getElementById('chart-data');
  if (!chartDataElement) {
    return;
  }

  try {
    const chartData = JSON.parse(chartDataElement.dataset.chart);
    if (!chartData || !chartData.calls || chartData.calls.length === 0) {
      return;
    }

    initializeChart(chartData);
  } catch (error) {
    console.error('Ошибка парсинга данных графика:', error);
  }
});

function initializeChart(data) {
  // 1. Находим или создаем canvas элемент
  let canvas = document.getElementById('timelineChart');

  // Если canvas не найден, создаем его
  if (!canvas) {
    const wrapper = document.querySelector('.chart-wrapper');
    if (!wrapper) {
      console.error('Не найден контейнер для графика');
      return;
    }

    canvas = document.createElement('canvas');
    canvas.id = 'timelineChart';
    canvas.width = wrapper.clientWidth;
    canvas.height = 300;
    wrapper.appendChild(canvas);
  }

  // 2. Проверяем, что это действительно canvas элемент
  if (!canvas.getContext) {
    console.error('Элемент не поддерживает getContext()', canvas);

    // Показываем сообщение об ошибке
    const wrapper = canvas.parentElement || document.querySelector('.chart-wrapper');
    if (wrapper) {
      wrapper.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle"></i>
          Ошибка инициализации графика: неверный тип элемента
        </div>
      `;
    }
    return;
  }

  // 3. Группируем данные по дням
  const callsByDay = {};
  data.calls.forEach(call => {
    try {
      // Извлекаем дату напрямую из строки (данные уже в локальном времени)
      const str = (call.startTime || '').toString();
      const match = str.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (!match) {
        console.warn('Неверный формат даты:', call.startTime);
        return;
      }

      const dateKey = `${match[3]}.${match[2]}`; // DD.MM
      const isoDate = `${match[1]}-${match[2]}-${match[3]}`; // YYYY-MM-DD

      if (!callsByDay[isoDate]) {
        callsByDay[isoDate] = {
          displayDate: dateKey,
          answered: 0,
          abandoned: 0
        };
      }

      if (call.status === 'abandoned') {
        callsByDay[isoDate].abandoned++;
      } else {
        callsByDay[isoDate].answered++;
      }
    } catch(e) {
      console.error('Ошибка обработки звонка:', e);
    }
  });

  // 4. Сортируем даты
  const sortedDates = Object.keys(callsByDay).sort();
  if (sortedDates.length === 0) {
    const wrapper = document.querySelector('.chart-wrapper');
    if (wrapper) {
      wrapper.innerHTML = '<div class="alert alert-info">Нет данных для отображения</div>';
    }
    return;
  }

  // 5. Создаем график
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Не удалось получить контекст canvas');

    const chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: sortedDates.map(date => callsByDay[date].displayDate),
        datasets: [
          {
            label: 'Принятые',
            data: sortedDates.map(date => callsByDay[date].answered),
            backgroundColor: 'rgba(16, 185, 129, 0.8)',
            borderColor: '#10b981',
            borderWidth: 2,
            borderRadius: 4,
            hoverBackgroundColor: 'rgba(16, 185, 129, 1)',
            hoverBorderColor: '#0f8c6a'
          },
          {
            label: 'Пропущенные',
            data: sortedDates.map(date => callsByDay[date].abandoned),
            backgroundColor: 'rgba(239, 68, 68, 0.8)',
            borderColor: '#ef4444',
            borderWidth: 2,
            borderRadius: 4,
            hoverBackgroundColor: 'rgba(239, 68, 68, 1)',
            hoverBorderColor: '#dc2626'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 1000,
          easing: 'easeOutQuart'
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleColor: '#ffffff',
            bodyColor: '#ffffff',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            cornerRadius: 8,
            callbacks: {
              label: function(context) {
                return `${context.dataset.label}: ${context.raw}`;
              }
            }
          }
        },
        scales: {
          x: {
            stacked: false,
            grid: {
              display: false,
              color: 'rgba(0, 0, 0, 0.1)'
            },
            ticks: {
              maxRotation: 45,
              minRotation: 45,
              color: 'var(--text-secondary)'
            }
          },
          y: {
            stacked: false,
            beginAtZero: true,
            grid: {
              color: 'rgba(0, 0, 0, 0.1)',
              borderDash: [2, 4]
            },
            ticks: {
              precision: 0,
              color: 'var(--text-secondary)'
            }
          }
        },
        elements: {
          bar: {
            borderRadius: 4,
            borderSkipped: false
          }
        },
        interaction: {
          intersect: false,
          mode: 'index'
        }
      }
    });

    // Регистрируем график в менеджере
    chartManager.setChart(chart);
  } catch (error) {
    console.error('Ошибка создания графика:', error);
    const wrapper = canvas.parentElement;
    if (wrapper) {
      wrapper.innerHTML = `
        <div class="alert alert-danger">
          <i class="bi bi-exclamation-triangle"></i>
          Ошибка при построении графика: ${error.message}
        </div>
      `;
    }
  }
}

// Функция воспроизведения записи
function playRecording(filename) {
  if (!filename) {
    console.error('No recording file provided');
    return;
  }

  // Извлекаем дату из имени файла
  const datePart = filename.split('-')[3];
  if (!datePart || datePart.length !== 8) {
    console.error('Invalid recording file format:', filename);
    return;
  }

  const year = datePart.substring(0, 4);
  const month = datePart.substring(4, 6);
  const day = datePart.substring(6, 8);
  const recordingUrl = `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(filename)}`;

  console.log('🎵 Playing recording:', recordingUrl);

  // Создаем audio элемент и воспроизводим
  const audio = new Audio(recordingUrl);
  audio.play().catch(err => {
    console.error('Error playing recording:', err);
    if (typeof notificationManager !== 'undefined') {
      notificationManager.show('Ошибка воспроизведения записи', 'error');
    }
  });

  // Добавляем обработчики событий
  audio.addEventListener('ended', () => {
    console.log('Recording playback finished');
  });

  audio.addEventListener('error', (e) => {
    console.error('Audio playback error:', e);
    if (typeof notificationManager !== 'undefined') {
      notificationManager.show('Ошибка загрузки записи', 'error');
    }
  });
}

// Делаем функцию доступной глобально
window.playRecording = playRecording;

