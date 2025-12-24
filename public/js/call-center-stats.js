// ===================== СТАТИСТИКА КОЛЛ-ЦЕНТРА =====================

class CallCenterStats {
  constructor() {
    this.init();
  }

  init() {
    this.initHourlyChart();
    this.animateKPICards();
  }

  initHourlyChart() {
    const chartContainer = document.getElementById('hourly-chart');
    if (!chartContainer) return;

    // Получаем данные из скрытого элемента
    const chartDataElement = document.getElementById('chart-data');
    if (!chartDataElement || !chartDataElement.dataset.chart) return;

    try {
      const data = JSON.parse(chartDataElement.dataset.chart);
      if (!data.stats || !data.stats.callsByHour) return;

      const callsByHour = data.stats.callsByHour;
      this.renderHourlyChart(chartContainer, callsByHour);
    } catch (error) {
      logger.error('Error loading hourly chart data:', error);
    }
  }

  renderHourlyChart(container, callsByHour) {
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const maxCalls = Math.max(...hours.map(h => callsByHour[h]?.total || 0), 1);

    const chartHeight = 200;
    const chartWidth = container.offsetWidth || 800;
    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const innerWidth = chartWidth - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;

    const barWidth = Math.max(8, innerWidth / 24 - 2);

    let svg = `
      <svg class="hourly-chart-svg" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="hourlyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#0061a6;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#004d84;stop-opacity:1" />
          </linearGradient>
        </defs>

        <!-- Grid lines -->
        <g class="grid-lines">
    `;

    // Горизонтальные линии
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + (innerHeight * i) / 4;
      const value = Math.round((maxCalls * (4 - i)) / 4);
      svg += `
        <line x1="${margin.left}" y1="${y}" x2="${chartWidth - margin.right}" y2="${y}" 
              stroke="rgba(148, 163, 184, 0.15)" stroke-width="1" stroke-dasharray="2,2"/>
        <text x="${margin.left - 5}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${value}</text>
      `;
    }

    svg += `</g>`;

    // Бары
    svg += `<g class="bars">`;
    hours.forEach((hour, index) => {
      const data = callsByHour[hour] || { total: 0, answered: 0, abandoned: 0 };
      const barHeight = maxCalls > 0 ? (data.total / maxCalls) * innerHeight : 0;
      const x = margin.left + index * (innerWidth / 24);
      const y = margin.top + innerHeight - barHeight;

      const isPeak = data.total === maxCalls;
      const fillColor = isPeak ? '#f59e0b' : 'url(#hourlyGradient)';

      svg += `
        <g class="hour-bar" data-hour="${hour}" data-total="${data.total}" data-answered="${data.answered}" data-abandoned="${data.abandoned}">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" 
                fill="${fillColor}" rx="2" ry="2"
                style="opacity: 0; transition: all 0.3s ease;"
                class="bar-rect"/>
          ${data.total > 0 ? `
            <text x="${x + barWidth / 2}" y="${y - 5}" 
                  text-anchor="middle" fill="#64748b" font-size="9" font-weight="600"
                  style="opacity: 0;">${data.total}</text>
          ` : ''}
        </g>
      `;
    });

    svg += `</g>`;

    // Ось X - часы
    hours.forEach((hour, index) => {
      if (hour % 3 === 0) { // Показываем каждые 3 часа
        const x = margin.left + index * (innerWidth / 24) + barWidth / 2;
        svg += `
          <text x="${x}" y="${chartHeight - 10}" 
                text-anchor="middle" fill="#64748b" font-size="10" font-weight="500">
            ${String(hour).padStart(2, '0')}:00
          </text>
        `;
      }
    });

    svg += `</svg>`;

    container.innerHTML = svg;

    // Анимация появления
    setTimeout(() => {
      const bars = container.querySelectorAll('.bar-rect');
      bars.forEach((bar, index) => {
        setTimeout(() => {
          bar.style.transition = 'all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
          bar.style.opacity = '1';
        }, index * 20);
      });

      const texts = container.querySelectorAll('text');
      texts.forEach((text, index) => {
        setTimeout(() => {
          text.style.transition = 'opacity 0.3s ease 0.2s';
          text.style.opacity = '1';
        }, index * 10);
      });
    }, 100);

    // Интерактивность
    this.initHourlyChartInteractivity(container, callsByHour);
  }

  initHourlyChartInteractivity(container, callsByHour) {
    const bars = container.querySelectorAll('.hour-bar');
    const tooltip = this.createTooltip();
    document.body.appendChild(tooltip);

    bars.forEach(bar => {
      const rect = bar.querySelector('.bar-rect');
      
      bar.addEventListener('mouseenter', (e) => {
        const hour = parseInt(bar.dataset.hour);
        const total = parseInt(bar.dataset.total);
        const answered = parseInt(bar.dataset.answered);
        const abandoned = parseInt(bar.dataset.abandoned);

        rect.style.transition = 'all 0.2s ease';
        rect.style.transform = 'scaleY(1.1) translateY(-2px)';
        rect.style.filter = 'brightness(1.2)';

        this.showTooltip(tooltip, e, {
          hour: `${String(hour).padStart(2, '0')}:00`,
          total: total,
          answered: answered,
          abandoned: abandoned
        });
      });

      bar.addEventListener('mouseleave', () => {
        rect.style.transition = 'all 0.2s ease';
        rect.style.transform = 'scaleY(1) translateY(0)';
        rect.style.filter = 'brightness(1)';
        this.hideTooltip(tooltip);
      });

      bar.addEventListener('mousemove', (e) => {
        this.updateTooltipPosition(tooltip, e);
      });
    });
  }

  createTooltip() {
    const tooltip = document.createElement('div');
    tooltip.className = 'hourly-chart-tooltip';
    tooltip.style.display = 'none';
    return tooltip;
  }

  showTooltip(tooltip, event, data) {
    tooltip.innerHTML = `
      <div class="tooltip-header">${data.hour}</div>
      <div class="tooltip-content">
        <div class="tooltip-row">
          <span class="tooltip-label">Всего:</span>
          <span class="tooltip-value">${data.total}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Принято:</span>
          <span class="tooltip-value success">${data.answered}</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-label">Пропущено:</span>
          <span class="tooltip-value error">${data.abandoned}</span>
        </div>
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

  animateKPICards() {
    const cards = document.querySelectorAll('.kpi-card, .metric-card');
    cards.forEach((card, index) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      setTimeout(() => {
        card.style.transition = 'all 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, index * 100);
    });
  }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('hourly-chart') || document.querySelector('.call-center-stats')) {
    new CallCenterStats();
  }
});

