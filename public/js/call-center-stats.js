// ===================== CALL CENTER STATS - DARK THEME v3 =====================

class CallCenterStats {
  constructor() {
    this.init();
  }

  init() {
    this.initHourlyChart();
    this.animateCards();
  }

  initHourlyChart() {
    const chartContainer = document.getElementById('hourly-chart');
    if (!chartContainer) return;

    const chartDataElement = document.getElementById('chart-data');
    if (!chartDataElement || !chartDataElement.dataset.chart) return;

    try {
      const data = JSON.parse(chartDataElement.dataset.chart);
      if (!data.stats || !data.stats.callsByHour) return;
      this.renderHourlyChart(chartContainer, data.stats.callsByHour);
    } catch (error) {
      console.error('Error loading hourly chart:', error);
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
            <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#4f46e5;stop-opacity:1" />
          </linearGradient>
          <linearGradient id="peakGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#f59e0b;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#d97706;stop-opacity:1" />
          </linearGradient>
        </defs>
        <g class="grid-lines">
    `;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + (innerHeight * i) / 4;
      const value = Math.round((maxCalls * (4 - i)) / 4);
      svg += `
        <line x1="${margin.left}" y1="${y}" x2="${chartWidth - margin.right}" y2="${y}" 
              stroke="rgba(255,255,255,0.06)" stroke-width="1" stroke-dasharray="3,3"/>
        <text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" fill="#6a6a7a" font-size="10" font-family="var(--font-mono)">${value}</text>
      `;
    }
    svg += `</g><g class="bars">`;

    // Bars
    hours.forEach((hour, index) => {
      const data = callsByHour[hour] || { total: 0, answered: 0, abandoned: 0 };
      const barHeight = maxCalls > 0 ? (data.total / maxCalls) * innerHeight : 0;
      const x = margin.left + index * (innerWidth / 24);
      const y = margin.top + innerHeight - barHeight;
      const isPeak = data.total === maxCalls && data.total > 0;
      const fillColor = isPeak ? 'url(#peakGradient)' : 'url(#hourlyGradient)';

      svg += `
        <g class="hour-bar" data-hour="${hour}" data-total="${data.total}" data-answered="${data.answered}" data-abandoned="${data.abandoned}">
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" 
                fill="${fillColor}" rx="3" ry="3"
                style="opacity: 0; transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);"
                class="bar-rect"/>
          ${data.total > 0 ? `
            <text x="${x + barWidth / 2}" y="${y - 6}" 
                  text-anchor="middle" fill="#a0a0b0" font-size="9" font-weight="600" font-family="var(--font-mono)"
                  style="opacity: 0;">${data.total}</text>
          ` : ''}
        </g>
      `;
    });
    svg += `</g>`;

    // X-axis labels
    hours.forEach((hour, index) => {
      if (hour % 3 === 0) {
        const x = margin.left + index * (innerWidth / 24) + barWidth / 2;
        svg += `
          <text x="${x}" y="${chartHeight - 12}" 
                text-anchor="middle" fill="#6a6a7a" font-size="10" font-weight="500" font-family="var(--font-mono)">
            ${String(hour).padStart(2, '0')}:00
          </text>
        `;
      }
    });

    svg += `</svg>`;
    container.innerHTML = svg;

    // Animate bars
    requestAnimationFrame(() => {
      container.querySelectorAll('.bar-rect').forEach((bar, i) => {
        setTimeout(() => { bar.style.opacity = '1'; }, i * 20);
      });
      container.querySelectorAll('.hour-bar text').forEach((text, i) => {
        setTimeout(() => { text.style.opacity = '1'; }, i * 20 + 100);
      });
    });

    this.initTooltips(container, callsByHour);
  }

  initTooltips(container, callsByHour) {
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.style.display = 'none';
    document.body.appendChild(tooltip);

    container.querySelectorAll('.hour-bar').forEach(bar => {
      const rect = bar.querySelector('.bar-rect');
      
      bar.addEventListener('mouseenter', (e) => {
        const hour = bar.dataset.hour;
        const total = bar.dataset.total;
        const answered = bar.dataset.answered;
        const abandoned = bar.dataset.abandoned;

        if (rect) {
          rect.style.filter = 'brightness(1.3)';
          rect.style.transform = 'scaleY(1.05)';
          rect.style.transformOrigin = 'bottom';
        }

        tooltip.innerHTML = `
          <div class="tooltip-header">${String(hour).padStart(2, '0')}:00</div>
          <div class="tooltip-row"><span class="tooltip-label">Всего:</span><span class="tooltip-value">${total}</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Принято:</span><span class="tooltip-value success">${answered}</span></div>
          <div class="tooltip-row"><span class="tooltip-label">Пропущено:</span><span class="tooltip-value error">${abandoned}</span></div>
        `;
        tooltip.style.display = 'block';
        this.updateTooltipPosition(tooltip, e);
      });

      bar.addEventListener('mouseleave', () => {
        if (rect) {
          rect.style.filter = 'brightness(1)';
          rect.style.transform = 'scaleY(1)';
        }
        tooltip.style.display = 'none';
      });

      bar.addEventListener('mousemove', (e) => this.updateTooltipPosition(tooltip, e));
    });
  }

  updateTooltipPosition(tooltip, e) {
    const x = Math.min(e.clientX + 12, window.innerWidth - tooltip.offsetWidth - 20);
    const y = Math.min(e.clientY - tooltip.offsetHeight - 12, window.innerHeight - tooltip.offsetHeight - 20);
    tooltip.style.left = x + 'px';
    tooltip.style.top = Math.max(y, 10) + 'px';
  }

  animateCards() {
    const cards = document.querySelectorAll('.kpi-card, .callback-item');
    cards.forEach((card, i) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      setTimeout(() => {
        card.style.transition = 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, i * 50);
    });
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('hourly-chart') || document.querySelector('.kpi-card')) {
    new CallCenterStats();
  }
});
