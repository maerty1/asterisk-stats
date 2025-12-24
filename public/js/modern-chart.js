// ===================== СОВРЕМЕННЫЙ ГРАФИК СТАТИСТИКИ ЗВОНКОВ =====================

class ModernChartManager {
  constructor() {
    this.chart = null;
    this.data = null;
    this.hoveredBar = null;
    this.tooltip = null;
  }

  createChart(data) {
    logger.log('=== CREATING MODERN CHART ===');
    logger.log('Chart data:', data);

    const container = document.getElementById('chart-container');
    if (!container) {
      logger.error('Chart container not found');
      return;
    }

    // Очищаем контейнер
    container.innerHTML = '';

    // Проверяем данные
    if (!data || !data.calls || !Array.isArray(data.calls) || data.calls.length === 0) {
      this.showPlaceholder(container, 'Нет данных для отображения');
      return;
    }

    this.data = data;

    // Группируем данные по дням
    const callsByDay = this.groupCallsByDay(data.calls);
    const dates = Object.keys(callsByDay).sort();

    if (dates.length === 0) {
      this.showPlaceholder(container, 'Нет данных для отображения');
      return;
    }

    // Создаем структуру графика
    const chartWrapper = document.createElement('div');
    chartWrapper.className = 'modern-chart-wrapper';

    // Рассчитываем статистику
    const totalCalls = data.stats?.totalCalls || data.calls.length;
    const totalAnswered = dates.reduce((sum, date) => sum + callsByDay[date].answered, 0);
    const totalAbandoned = dates.reduce((sum, date) => sum + callsByDay[date].abandoned, 0);

    // Заголовок
    const title = document.createElement('div');
    title.className = 'modern-chart-title';
    title.innerHTML = `
      <h3>Статистика звонков</h3>
      <div class="chart-stats">
        <span class="stat-item">
          <span class="stat-label">Всего:</span>
          <span class="stat-value">${totalCalls}</span>
        </span>
        <span class="stat-item">
          <span class="stat-label">Принято:</span>
          <span class="stat-value success">${totalAnswered}</span>
        </span>
        <span class="stat-item">
          <span class="stat-label">Пропущено:</span>
          <span class="stat-value error">${totalAbandoned}</span>
        </span>
      </div>
    `;
    chartWrapper.appendChild(title);

    // Контейнер для графика
    const chartContainer = document.createElement('div');
    chartContainer.className = 'modern-chart-container';
    chartContainer.innerHTML = this.createSVGChart(callsByDay, dates);
    chartWrapper.appendChild(chartContainer);

    // Легенда
    const legend = this.createLegend();
    chartWrapper.appendChild(legend);

    container.appendChild(chartWrapper);

    // Инициализируем интерактивность
    this.initInteractivity(chartContainer, callsByDay, dates);

    // Анимация появления
    this.animateChart(chartContainer);

    logger.log('Modern chart created successfully');
  }

  groupCallsByDay(calls) {
    const callsByDay = {};
    
    calls.forEach(call => {
      try {
        if (!call.startTime) return;

        const date = new Date(call.startTime);
        if (isNaN(date.getTime())) return;

        // Используем полную дату для правильной сортировки
        const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const displayDate = date.toLocaleDateString('ru-RU', {
          day: '2-digit',
          month: '2-digit'
        });

        if (!callsByDay[dateKey]) {
          callsByDay[dateKey] = { 
            answered: 0, 
            abandoned: 0,
            displayDate: displayDate,
            fullDate: date
          };
        }

        if (call.status === 'abandoned' || call.status === 'completed_by_caller') {
          callsByDay[dateKey].abandoned++;
        } else {
          callsByDay[dateKey].answered++;
        }
      } catch (e) {
        logger.error('Error processing call:', e);
      }
    });

    return callsByDay;
  }

  createSVGChart(callsByDay, dates) {
    const maxValue = Math.max(...dates.flatMap(date => [
      callsByDay[date].answered,
      callsByDay[date].abandoned
    ]), 1);

    const chartHeight = 400;
    const chartWidth = Math.max(800, dates.length * 80);
    const margin = { top: 40, right: 40, bottom: 80, left: 80 };
    const innerWidth = chartWidth - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;

    const barWidth = Math.max(20, Math.min(40, innerWidth / dates.length / 2.5));
    const groupWidth = innerWidth / dates.length;
    const barSpacing = 4;

    let svg = `
      <svg class="modern-chart-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <!-- Градиенты для баров -->
          <linearGradient id="answeredGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#10b981;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#059669;stop-opacity:1" />
          </linearGradient>
          <linearGradient id="abandonedGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#f59e0b;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#d97706;stop-opacity:1" />
          </linearGradient>
          
          <!-- Тени для баров -->
          <filter id="barShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="3"/>
            <feOffset dx="0" dy="2" result="offsetblur"/>
            <feComponentTransfer>
              <feFuncA type="linear" slope="0.3"/>
            </feComponentTransfer>
            <feMerge>
              <feMergeNode/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>

        <!-- Сетка -->
        <g class="grid-lines">
    `;

    // Горизонтальные линии сетки
    for (let i = 0; i <= 5; i++) {
      const y = margin.top + (innerHeight * i) / 5;
      const value = Math.round((maxValue * (5 - i)) / 5);
      
      svg += `
        <line x1="${margin.left}" y1="${y}" x2="${chartWidth - margin.right}" y2="${y}" 
              class="grid-line" stroke="rgba(148, 163, 184, 0.2)" stroke-width="1" stroke-dasharray="4,4"/>
        <text x="${margin.left - 10}" y="${y + 4}" class="y-axis-label" text-anchor="end" fill="#64748b" font-size="12">${value}</text>
      `;
    }

    svg += `</g>`;

    // Бары
    svg += `<g class="bars">`;
    
    dates.forEach((date, index) => {
      const groupX = margin.left + index * groupWidth;
      const answered = callsByDay[date].answered;
      const abandoned = callsByDay[date].abandoned;

      const answeredHeight = maxValue > 0 ? (answered / maxValue) * innerHeight : 0;
      const abandonedHeight = maxValue > 0 ? (abandoned / maxValue) * innerHeight : 0;

      const answeredY = margin.top + innerHeight - answeredHeight;
      const abandonedY = margin.top + innerHeight - abandonedHeight;

      const barX1 = groupX + (groupWidth - (barWidth * 2 + barSpacing)) / 2;
      const barX2 = barX1 + barWidth + barSpacing;

      // Бар принятых звонков
      if (answered > 0) {
        svg += `
          <g class="bar-group answered-bar" data-date="${date}" data-value="${answered}" data-type="answered">
            <rect x="${barX1}" y="${answeredY}" width="${barWidth}" height="${answeredHeight}" 
                  fill="url(#answeredGradient)" filter="url(#barShadow)" 
                  class="bar-rect" rx="4" ry="4"
                  style="opacity: 0; transform: scaleY(0); transform-origin: bottom;"/>
            <text x="${barX1 + barWidth / 2}" y="${answeredY - 5}" 
                  class="bar-value" text-anchor="middle" fill="#10b981" font-size="11" font-weight="600"
                  style="opacity: 0;">${answered}</text>
          </g>
        `;
      }

      // Бар пропущенных звонков
      if (abandoned > 0) {
        svg += `
          <g class="bar-group abandoned-bar" data-date="${date}" data-value="${abandoned}" data-type="abandoned">
            <rect x="${barX2}" y="${abandonedY}" width="${barWidth}" height="${abandonedHeight}" 
                  fill="url(#abandonedGradient)" filter="url(#barShadow)" 
                  class="bar-rect" rx="4" ry="4"
                  style="opacity: 0; transform: scaleY(0); transform-origin: bottom;"/>
            <text x="${barX2 + barWidth / 2}" y="${abandonedY - 5}" 
                  class="bar-value" text-anchor="middle" fill="#f59e0b" font-size="11" font-weight="600"
                  style="opacity: 0;">${abandoned}</text>
          </g>
        `;
      }

      // Метка даты
      const dateLabel = callsByDay[date].displayDate;
      svg += `
        <text x="${groupX + groupWidth / 2}" y="${chartHeight - margin.bottom + 20}" 
              class="x-axis-label" text-anchor="middle" fill="#64748b" font-size="11" font-weight="500">
          ${dateLabel}
        </text>
      `;
    });

    svg += `</g>`;

    // Оси
    svg += `
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${chartHeight - margin.bottom}" 
            class="axis-line" stroke="#64748b" stroke-width="2"/>
      <line x1="${margin.left}" y1="${chartHeight - margin.bottom}" 
            x2="${chartWidth - margin.right}" y2="${chartHeight - margin.bottom}" 
            class="axis-line" stroke="#64748b" stroke-width="2"/>
    `;

    // Заголовки осей
    svg += `
      <text x="${chartWidth / 2}" y="${chartHeight - 10}" class="axis-title" text-anchor="middle" fill="#374151" font-size="13" font-weight="600">Даты</text>
      <text x="20" y="${chartHeight / 2}" class="axis-title" text-anchor="middle" fill="#374151" font-size="13" font-weight="600" transform="rotate(-90, 20, ${chartHeight / 2})">Количество звонков</text>
    `;

    svg += `</svg>`;

    return svg;
  }

  createLegend() {
    const legend = document.createElement('div');
    legend.className = 'modern-chart-legend';
    legend.innerHTML = `
      <div class="legend-item">
        <div class="legend-indicator answered"></div>
        <span class="legend-text">Принятые звонки</span>
      </div>
      <div class="legend-item">
        <div class="legend-indicator abandoned"></div>
        <span class="legend-text">Пропущенные звонки</span>
      </div>
    `;
    return legend;
  }

  initInteractivity(container, callsByDay, dates) {
    const bars = container.querySelectorAll('.bar-group');
    const tooltip = this.createTooltip();
    document.body.appendChild(tooltip);

    bars.forEach(bar => {
      const rect = bar.querySelector('.bar-rect');
      const valueText = bar.querySelector('.bar-value');
      
      // Hover эффект
      bar.addEventListener('mouseenter', (e) => {
        const date = bar.dataset.date;
        const value = bar.dataset.value;
        const type = bar.dataset.type;
        
        rect.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        rect.style.transform = 'scaleY(1.05) translateY(-2px)';
        rect.style.filter = 'brightness(1.2)';
        valueText.style.opacity = '1';
        
        this.showTooltip(tooltip, e, {
          date: callsByDay[date].displayDate,
          value: value,
          type: type === 'answered' ? 'Принятые' : 'Пропущенные'
        });
      });

      bar.addEventListener('mouseleave', () => {
        rect.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        rect.style.transform = 'scaleY(1) translateY(0)';
        rect.style.filter = 'brightness(1)';
        valueText.style.opacity = '0';
        this.hideTooltip(tooltip);
      });

      bar.addEventListener('mousemove', (e) => {
        this.updateTooltipPosition(tooltip, e);
      });
    });
  }

  createTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'modern-chart-tooltip';
    tooltip.style.display = 'none';
    return tooltip;
  }

  showTooltip(tooltip, event, data) {
    tooltip.innerHTML = `
      <div class="tooltip-date">${data.date}</div>
      <div class="tooltip-content">
        <span class="tooltip-label">${data.type}:</span>
        <span class="tooltip-value">${data.value}</span>
      </div>
    `;
    tooltip.style.display = 'block';
    this.updateTooltipPosition(tooltip, event);
  }

  updateTooltipPosition(tooltip, event) {
    const rect = tooltip.getBoundingClientRect();
    const x = event.clientX + 10;
    const y = event.clientY - rect.height - 10;
    
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  hideTooltip(tooltip) {
    tooltip.style.display = 'none';
  }

  animateChart(container) {
    const bars = container.querySelectorAll('.bar-rect');
    const values = container.querySelectorAll('.bar-value');
    
    bars.forEach((bar, index) => {
      setTimeout(() => {
        bar.style.transition = 'all 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)';
        bar.style.opacity = '1';
        bar.style.transform = 'scaleY(1)';
      }, index * 50);
    });

    values.forEach((value, index) => {
      setTimeout(() => {
        value.style.transition = 'opacity 0.3s ease 0.3s';
        value.style.opacity = '0';
      }, index * 50);
    });
  }

  showPlaceholder(container, message) {
    container.innerHTML = `
      <div class="modern-chart-placeholder">
        <div class="placeholder-icon">📊</div>
        <div class="placeholder-text">${message}</div>
      </div>
    `;
  }
}

// Экспортируем для использования
window.ModernChartManager = ModernChartManager;

