/**
 * Менеджер уведомлений (Toast Notifications)
 * @module notification-manager
 */

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
window.notificationManager = new NotificationManager();
