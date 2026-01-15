/**
 * Утилиты экспорта данных
 * @module export-utils
 */

/**
 * Форматировать номер телефона (убрать +7 или 7)
 * @param {string} number - Номер телефона
 * @returns {string} Отформатированный номер
 */
function formatPhoneNumber(number) {
  if (!number || number === '-') return number;
  const num = number.toString().trim();
  if (num.startsWith('+7')) {
    return num.substring(2);
  }
  if (num.startsWith('7') && num.length > 10) {
    return num.substring(1);
  }
  return num;
}

/**
 * Экспорт данных в CSV
 */
function exportToCSV() {
  try {
    const chartDataElement = document.getElementById('chart-data');
    if (!chartDataElement) {
      window.notificationManager?.show('Нет данных для экспорта', 'warning');
      return;
    }

    const data = JSON.parse(chartDataElement.dataset.chart);
    if (!data.calls || data.calls.length === 0) {
      window.notificationManager?.show('Нет данных для экспорта', 'warning');
      return;
    }

    // Создаем CSV
    const headers = ['Дата', 'Время', 'Клиент', 'Ожидание (сек)', 'Длительность', 'Статус'];
    const csvContent = [
      headers.join(','),
      ...data.calls.map(call => {
        // Для исходящих звонков показываем destination (длинный номер)
        const rawNumber = call.isOutbound && call.destination 
          ? (call.destination || call.clientNumber || '-') 
          : (call.clientNumber || '-');
        
        const displayNumber = formatPhoneNumber(rawNumber);
        
        // Извлекаем дату и время напрямую из строки
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
    window.notificationManager?.show('Данные успешно экспортированы в CSV', 'success');
  } catch (error) {
    console.error('Ошибка экспорта CSV:', error);
    alert('Ошибка при экспорте CSV');
  }
}

/**
 * Экспорт данных в JSON
 */
function exportToJSON() {
  try {
    const chartDataElement = document.getElementById('chart-data');
    if (!chartDataElement) {
      window.notificationManager?.show('Нет данных для экспорта', 'warning');
      return;
    }

    const data = JSON.parse(chartDataElement.dataset.chart);
    const jsonContent = JSON.stringify(data, null, 2);

    downloadFile(jsonContent, 'asterisk-report.json', 'application/json');
    window.notificationManager?.show('Данные успешно экспортированы в JSON', 'success');
  } catch (error) {
    console.error('Ошибка экспорта JSON:', error);
    alert('Ошибка при экспорте JSON');
  }
}

/**
 * Скачать файл
 * @param {string} content - Содержимое файла
 * @param {string} filename - Имя файла
 * @param {string} mimeType - MIME тип
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);

  a.click();

  // Анимируем кнопку экспорта
  const exportButtons = document.querySelectorAll('#export-csv, #export-json');
  exportButtons.forEach(btn => {
    window.animationManager?.animateElement(btn, 'bounce');
  });

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Экспорт в глобальную область
window.exportToCSV = exportToCSV;
window.exportToJSON = exportToJSON;
window.downloadFile = downloadFile;
window.formatPhoneNumber = formatPhoneNumber;
