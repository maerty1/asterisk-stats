/**
 * Менеджер анимаций и эффектов
 * @module animation-manager
 */

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
window.animationManager = new AnimationManager();
