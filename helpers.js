// Helper functions for Asterisk queue analysis
const { format } = require('date-fns');

const helpers = {
  translateStatus: (status) => {
    const statusMap = {
      'completed_by_caller': '<i class="bi bi-telephone-outbound-fill me-1"></i> Завершен клиентом',
      'completed_by_agent': '<i class="bi bi-telephone-inbound-fill me-1"></i> Завершен агентом',
      'abandoned': '<i class="bi bi-telephone-x-fill me-1"></i> Неотвечен'
    };
    return statusMap[status] || status;
  },

  calculateWaitTime: (call) => {
    if (!call.startTime) return '-';
    const endTime = call.connectTime || call.endTime;
    if (!endTime) return '-';
    const start = new Date(call.startTime);
    const end = new Date(endTime);
    return Math.round((end - start) / 1000);
  },

  formatDuration: (sec) => {
    if (!sec || isNaN(sec)) return '-';
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins} мин ${secs} сек`;
  },

  formatTime: (timeStr) => {
    if (!timeStr) return '-';
    const date = new Date(timeStr);
    return date.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  },

  formatShortDate: (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit'
    });
  },

  getRecordingLink: (recordingFile) => {
    if (!recordingFile) return null;

    const datePart = recordingFile.split('-')[3];
    if (!datePart || datePart.length !== 8) return null;

    const year = datePart.substring(0, 4);
    const month = datePart.substring(4, 6);
    const day = datePart.substring(6, 8);

    return `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
  }
};

module.exports = helpers;