/**
 * Status Monitor - Independent module for system status and clock
 * Does not depend on other project components
 */
(function() {
  'use strict';

  // Real-time clock update
  function updateClock() {
    const timeElement = document.getElementById('current-time');
    if (timeElement) {
      const now = new Date();
      timeElement.textContent = now.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    }
  }

  // System status check
  async function checkSystemStatus() {
    const statusIndicator = document.getElementById('status-indicator');
    const statusText = document.getElementById('status-text');
    const statusContainer = document.getElementById('system-status');
    
    if (!statusIndicator || !statusText || !statusContainer) return;

    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      
      if (data.status === 'online' && data.database === 'connected') {
        statusIndicator.textContent = '●';
        statusIndicator.style.color = '#10b981';
        statusText.textContent = 'Online';
        statusContainer.className = 'performance-indicator online';
      } else {
        statusIndicator.textContent = '●';
        statusIndicator.style.color = '#f59e0b';
        statusText.textContent = 'Warning';
        statusContainer.className = 'performance-indicator warning';
      }
    } catch (error) {
      statusIndicator.textContent = '●';
      statusIndicator.style.color = '#ef4444';
      statusText.textContent = 'Offline';
      statusContainer.className = 'performance-indicator offline';
      console.error('Status check failed:', error);
    }
  }

  // Initialize when DOM is ready
  function init() {
    // Update clock immediately and every second
    updateClock();
    setInterval(updateClock, 1000);

    // Check status on load and every 30 seconds
    checkSystemStatus();
    setInterval(checkSystemStatus, 30000);
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

