const CACHE_NAME = 'asterisk-stats-v1';
const STATIC_CACHE_URLS = [
  '/',
  '/css/style.css',
  '/js/chart.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.0/font/bootstrap-icons.css',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
];

// Установка Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// Активация Service Worker
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват запросов
self.addEventListener('fetch', event => {
  // Кэшируем только GET запросы
  if (event.request.method !== 'GET') return;

  // Пропускаем API запросы и динамический контент
  if (event.request.url.includes('/report') ||
      event.request.url.includes('/recordings') ||
      event.request.url.includes('chrome-extension://')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Возвращаем из кэша если есть
        if (response) {
          return response;
        }

        // Иначе делаем запрос и кэшируем
        return fetch(event.request).then(response => {
          // Проверяем валидность ответа
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Клонируем ответ для кэширования
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });

          return response;
        });
      })
      .catch(() => {
        // При ошибке сети возвращаем оффлайн страницу если это HTML запрос
        if (event.request.headers.get('accept').includes('text/html')) {
          return caches.match('/');
        }
      })
  );
});
