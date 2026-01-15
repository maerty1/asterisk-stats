/**
 * Загрузчик модулей
 * Загружает все модули в правильном порядке
 * @module modules/index
 */

// Режим отладки
const DEBUG = localStorage.getItem('DEBUG') === 'true';

/**
 * Загрузить скрипт динамически
 * @param {string} src - Путь к скрипту
 * @returns {Promise} 
 */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    // Проверяем, не загружен ли уже
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Загрузить все модули
 */
async function loadAllModules() {
  const modules = [
    '/js/modules/notification-manager.js',
    '/js/modules/animation-manager.js',
    '/js/modules/export-utils.js'
  ];
  
  for (const module of modules) {
    try {
      await loadScript(module);
      if (DEBUG) console.log(`[Modules] Loaded: ${module}`);
    } catch (error) {
      console.error(`[Modules] Failed to load: ${module}`, error);
    }
  }
  
  if (DEBUG) console.log('[Modules] All modules loaded');
}

// Автозагрузка при готовности DOM
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAllModules);
} else {
  loadAllModules();
}
