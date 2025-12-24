// ===================== СОВРЕМЕННЫЙ АУДИО-ПЛЕЕР ДЛЯ ЗАПИСЕЙ =====================

class ModernAudioPlayer {
  constructor(container, recordingFile, recordingUrl) {
    this.container = container;
    this.recordingFile = recordingFile;
    this.recordingUrl = recordingUrl;
    this.audio = null;
    this.isPlaying = false;
    this.currentTime = 0;
    this.duration = 0;
    this.progressBarVisible = false;
    this.init();
  }

  init() {
    this.createPlayer();
    this.setupEventListeners();
  }

  createPlayer() {
    this.container.innerHTML = '';
    this.container.className = 'modern-audio-player-container';

    const playerHTML = `
      <div class="audio-player-buttons">
        <button class="audio-play-btn" aria-label="Воспроизвести">
          <svg class="play-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <svg class="pause-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display: none;">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>
        
        <button class="audio-download-btn" aria-label="Скачать запись" title="Скачать запись">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
        </button>
      </div>

      <div class="audio-progress-wrapper" style="display: none;">
        <div class="audio-progress-container">
          <div class="audio-progress-bar">
            <div class="audio-progress-fill" style="width: 0%"></div>
            <div class="audio-progress-handle" style="left: 0%"></div>
          </div>
          <div class="audio-time">
            <span class="audio-current-time">0:00</span>
            <span class="audio-separator">/</span>
            <span class="audio-duration">0:00</span>
          </div>
        </div>
      </div>

      <audio preload="metadata" style="display: none;">
        <source src="${this.recordingUrl}" type="audio/mpeg">
      </audio>
    `;

    this.container.innerHTML = playerHTML;
    this.audio = this.container.querySelector('audio');
    this.playBtn = this.container.querySelector('.audio-play-btn');
    this.downloadBtn = this.container.querySelector('.audio-download-btn');
    this.progressWrapper = this.container.querySelector('.audio-progress-wrapper');
    this.progressBar = this.container.querySelector('.audio-progress-bar');
    this.progressFill = this.container.querySelector('.audio-progress-fill');
    this.progressHandle = this.container.querySelector('.audio-progress-handle');
    this.currentTimeEl = this.container.querySelector('.audio-current-time');
    this.durationEl = this.container.querySelector('.audio-duration');
  }

  setupEventListeners() {
    // Воспроизведение/пауза
    this.playBtn.addEventListener('click', () => {
      if (this.isPlaying) {
        this.pause();
      } else {
        this.play();
      }
    });

    // Прогресс-бар
    this.progressBar.addEventListener('click', (e) => {
      const rect = this.progressBar.getBoundingClientRect();
      const percent = (e.clientX - rect.left) / rect.width;
      this.seek(percent);
    });

    // Перетаскивание прогресс-бара
    let isDragging = false;
    this.progressHandle.addEventListener('mousedown', (e) => {
      isDragging = true;
      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const rect = this.progressBar.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        this.seek(percent);
      }
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // События аудио
    this.audio.addEventListener('loadedmetadata', () => {
      this.duration = this.audio.duration;
      this.updateDuration();
    });

    this.audio.addEventListener('timeupdate', () => {
      this.currentTime = this.audio.currentTime;
      this.updateProgress();
    });

    this.audio.addEventListener('ended', () => {
      this.isPlaying = false;
      this.updatePlayButton();
      this.currentTime = 0;
      this.updateProgress();
      this.hideProgressBar();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayButton();
      this.showProgressBar();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayButton();
    });

    this.audio.addEventListener('error', (e) => {
      logger.error('Audio error:', e);
      this.showError();
    });

    // Скачивание
    this.downloadBtn.addEventListener('click', () => {
      this.download();
    });
  }

  play() {
    this.audio.play().catch(error => {
      logger.error('Error playing audio:', error);
      this.showError();
    });
  }

  pause() {
    this.audio.pause();
  }

  seek(percent) {
    if (this.duration) {
      this.audio.currentTime = this.duration * percent;
    }
  }

  updateProgress() {
    if (this.duration) {
      const percent = (this.currentTime / this.duration) * 100;
      this.progressFill.style.width = `${percent}%`;
      this.progressHandle.style.left = `${percent}%`;
      this.updateCurrentTime();
    }
  }

  updateCurrentTime() {
    this.currentTimeEl.textContent = this.formatTime(this.currentTime);
  }

  updateDuration() {
    this.durationEl.textContent = this.formatTime(this.duration);
  }

  updatePlayButton() {
    const playIcon = this.playBtn.querySelector('.play-icon');
    const pauseIcon = this.playBtn.querySelector('.pause-icon');
    
    if (this.isPlaying) {
      playIcon.style.display = 'none';
      pauseIcon.style.display = 'block';
      this.playBtn.classList.add('playing');
    } else {
      playIcon.style.display = 'block';
      pauseIcon.style.display = 'none';
      this.playBtn.classList.remove('playing');
    }
  }

  showProgressBar() {
    if (!this.progressBarVisible) {
      this.progressBarVisible = true;
      this.progressWrapper.style.display = 'block';
      
      // Плавное появление
      setTimeout(() => {
        this.progressWrapper.style.opacity = '1';
        this.progressWrapper.style.transform = 'translateY(0)';
      }, 10);
    }
  }

  hideProgressBar() {
    if (this.progressBarVisible) {
      this.progressBarVisible = false;
      this.progressWrapper.style.opacity = '0';
      this.progressWrapper.style.transform = 'translateY(-5px)';
      
      setTimeout(() => {
        if (!this.isPlaying) {
          this.progressWrapper.style.display = 'none';
        }
      }, 300);
    }
  }

  formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }

  download() {
    const link = document.createElement('a');
    link.href = this.recordingUrl;
    link.download = this.recordingFile || 'recording.mp3';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    // Анимация кнопки
    this.downloadBtn.classList.add('downloading');
    setTimeout(() => {
      this.downloadBtn.classList.remove('downloading');
    }, 300);
  }

  showError() {
    this.container.innerHTML = `
      <div class="audio-error">
        <span class="error-icon">⚠️</span>
        <span class="error-text">Ошибка загрузки записи</span>
      </div>
    `;
  }
}

// Функция для инициализации всех аудио-плееров в таблице
function initializeModernAudioPlayers() {
  logger.log('=== INITIALIZING MODERN AUDIO PLAYERS ===');
  
  // Ищем все ячейки с записями - используем более широкий селектор
  const audioCells = document.querySelectorAll('td.audio-cell[data-recording], td[data-recording]');
  logger.log('Found audio cells:', audioCells.length);
  
  if (audioCells.length === 0) {
    logger.warn('No audio cells found. Trying alternative selector...');
    // Альтернативный поиск - все ячейки в последней колонке таблицы
    const tableBody = document.getElementById('calls-table-body');
    if (tableBody) {
      const allCells = Array.from(tableBody.querySelectorAll('tr td:last-child'));
      logger.log('Found last column cells:', allCells.length);
      allCells.forEach(cell => {
        const recording = cell.getAttribute('data-recording');
        if (recording) {
          audioCells.push(cell);
        }
      });
    }
  }
  
  audioCells.forEach((cell, index) => {
    const recordingFile = cell.getAttribute('data-recording');
    const status = cell.getAttribute('data-status');
    
    logger.log(`Processing cell ${index}:`, { recordingFile, status });
    
    // Пропускаем если уже инициализирован
    if (cell.querySelector('.modern-audio-player-container')) {
      logger.log('Cell already has player, skipping');
      return;
    }
    
    if (!recordingFile || recordingFile === '' || status === 'abandoned') {
      cell.innerHTML = '<span class="no-recording">Нет записи</span>';
      return;
    }

    // Формируем URL
    const getRecordingLink = (recordingFile) => {
      if (!recordingFile) return null;
      const parts = recordingFile.split('-');
      if (parts.length < 4) {
        logger.error('Invalid filename format:', recordingFile);
        return null;
      }
      const datePart = parts[3];
      if (!datePart || datePart.length !== 8) {
        logger.error('Invalid date part:', datePart);
        return null;
      }
      const year = datePart.substring(0, 4);
      const month = datePart.substring(4, 6);
      const day = datePart.substring(6, 8);
      return `/recordings/${year}/${month}/${day}?file=${encodeURIComponent(recordingFile)}`;
    };

    const recordingUrl = getRecordingLink(recordingFile);
    if (!recordingUrl) {
      logger.error('Failed to generate recording URL for:', recordingFile);
      cell.innerHTML = '<span class="audio-error">Ошибка URL</span>';
      return;
    }

    logger.log('Creating modern audio player for:', recordingFile, 'URL:', recordingUrl);
    
    try {
      // Создаем современный плеер
      new ModernAudioPlayer(cell, recordingFile, recordingUrl);
      logger.log('Modern audio player created successfully');
    } catch (error) {
      logger.error('Error creating modern audio player:', error);
      cell.innerHTML = '<span class="audio-error">Ошибка инициализации</span>';
    }
  });
  
  logger.log('=== MODERN AUDIO PLAYERS INITIALIZATION COMPLETE ===');
}

// Экспорт для использования
window.ModernAudioPlayer = ModernAudioPlayer;
window.initializeModernAudioPlayers = initializeModernAudioPlayers;
