/**
 * View Routes - страницы приложения
 * @module routes/views
 */

const express = require('express');
const router = express.Router();
const helpers = require('../helpers');

// Эти функции будут инжектированы из app.js
let getFilterParams = null;
let getAvailableQueues = null;

/**
 * Инициализация роутера с зависимостями
 * @param {Object} deps - Зависимости
 * @param {Function} deps.getFilterParams - Функция получения параметров фильтра
 * @param {Function} deps.getAvailableQueues - Функция получения списка очередей
 */
function init(deps) {
  getFilterParams = deps.getFilterParams;
  getAvailableQueues = deps.getAvailableQueues;
}

/**
 * Главная страница - Входящая очередь
 */
router.get('/', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Аналитика звонков',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'queue',
    helpers
  });
});

/**
 * Страница входящих звонков
 */
router.get('/inbound', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Входящие звонки - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'inbound',
    helpers
  });
});

/**
 * Страница исходящих очередей
 */
router.get('/outbound-queue', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Исходящие очереди - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'outbound_queue',
    helpers
  });
});

/**
 * Страница исходящих звонков
 */
router.get('/outbound', (req, res) => {
  const params = getFilterParams(req);
  res.render('index', { 
    title: 'Исходящие звонки - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    selectedQueue: params.selectedQueue,
    viewType: 'outbound',
    helpers
  });
});

/**
 * Страница рейтинга очередей
 */
router.get('/rankings', (req, res) => {
  const params = getFilterParams(req);
  res.render('rankings', { 
    title: 'Рейтинг очередей - Asterisk Analytics',
    queues: getAvailableQueues(),
    results: null,
    startDate: params.startDate,
    endDate: params.endDate,
    sortBy: req.query.sortBy || 'composite',
    departmentFilter: req.query.departmentFilter || '',
    helpers
  });
});

/**
 * Тестовая страница
 */
router.get('/test', (req, res) => {
  res.render('index', { 
    title: 'Test Page',
    queues: getAvailableQueues(),
    results: null,
    startDate: new Date().toISOString().split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
    selectedQueue: '',
    viewType: 'queue',
    helpers
  });
});

module.exports = { router, init };
