require('dotenv').config();
const nodemailer = require('nodemailer');
const { format, subDays } = require('date-fns');
const { ru } = require('date-fns/locale');
const { execute: dbExecute } = require('./db-optimizer');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const os = require('os');
// Используем settings-db.js вместо sqlite-email-db.js, так как он уже инициализирован
const settingsDb = require('./settings-db');

// Конфигурация SMTP
const createTransporter = () => {
  const smtpConfig = {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true для 465, false для других портов
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  };

  // Если не указаны учетные данные, возвращаем null (отправка отключена)
  if (!smtpConfig.auth.user || !smtpConfig.auth.pass) {
    console.warn('⚠️ SMTP credentials not configured. Email sending disabled.');
    return null;
  }

  return nodemailer.createTransport(smtpConfig);
};

// Генерация HTML шаблона письма
function generateEmailTemplate(reportData) {
  const { date, generationDate, queues, inbound, outbound } = reportData;
  
  // Если generationDate не передан, вычисляем его с учетом часового пояса
  let currentGenerationDate = generationDate;
  if (!currentGenerationDate) {
    const settingsDb = require('./settings-db');
    function getTimezoneLocal() {
      try {
        const settings = settingsDb.getAllSettings();
        return settings.TZ || 'Europe/Moscow';
      } catch (err) {
        return process.env.TZ || 'Europe/Moscow';
      }
    }
    function getTimezoneOffsetLocal(timezone) {
      const timezoneOffsets = {
        'Europe/Moscow': 3, 'Europe/Kiev': 2, 'Europe/Kyiv': 2, 'Europe/Minsk': 3,
        'Asia/Yekaterinburg': 5, 'Asia/Krasnoyarsk': 7, 'Asia/Irkutsk': 8,
        'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10, 'Europe/London': 0,
        'Europe/Paris': 1, 'Europe/Berlin': 1, 'America/New_York': -5,
        'America/Los_Angeles': -8, 'Asia/Tashkent': 5, 'Asia/Almaty': 6
      };
      if (timezoneOffsets.hasOwnProperty(timezone)) {
        return timezoneOffsets[timezone];
      }
      if (timezone.includes('Moscow') || timezone.includes('Minsk')) return 3;
      if (timezone.includes('Kiev') || timezone.includes('Kyiv') || timezone.includes('EET')) return 2;
      if (timezone.includes('London') || timezone.includes('UTC')) return 0;
      return 0;
    }
    const timezone = getTimezoneLocal();
    const offsetHours = getTimezoneOffsetLocal(timezone);
    const now = new Date();
    const nowInLocalTZ = new Date(now.getTime() + (offsetHours * 60 * 60 * 1000));
    currentGenerationDate = format(nowInLocalTZ, 'dd.MM.yyyy HH:mm:ss', { locale: ru });
  }
  
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    // Преобразуем в число, если это строка
    const sec = typeof seconds === 'string' ? parseInt(seconds, 10) : Number(seconds);
    
    // Проверяем на разумность значения (не больше 2 часов = 7200 секунд)
    if (isNaN(sec) || sec < 0 || sec > 7200) {
      return '0:00';
    }
    
    const mins = Math.floor(sec / 60);
    const remainingSecs = sec % 60;
    return `${mins}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
  };

  const formatNumber = (num) => {
    return num ? num.toLocaleString('ru-RU') : '0';
  };

  let html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ежедневный отчет по звонкам - ${date}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #0061a6;
      border-bottom: 3px solid #0061a6;
      padding-bottom: 10px;
      margin-bottom: 30px;
    }
    h2 {
      color: #535f70;
      margin-top: 30px;
      margin-bottom: 15px;
      font-size: 1.3em;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 20px 0;
    }
    .stat-card {
      background: #f8f9fa;
      border-left: 4px solid #0061a6;
      padding: 15px;
      border-radius: 4px;
    }
    .stat-card.success {
      border-left-color: #4caf50;
    }
    .stat-card.danger {
      border-left-color: #f44336;
    }
    .stat-card.warning {
      border-left-color: #ff9800;
    }
    .stat-label {
      font-size: 0.85em;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: #333;
    }
    .stat-description {
      font-size: 0.9em;
      color: #666;
      margin-top: 5px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      background: white;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #ddd;
    }
    th {
      background: #0061a6;
      color: white;
      font-weight: 600;
    }
    tr:hover {
      background: #f5f5f5;
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 500;
    }
    .badge-success {
      background: #4caf50;
      color: white;
    }
    .badge-danger {
      background: #f44336;
      color: white;
    }
    .badge-warning {
      background: #ff9800;
      color: white;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      color: #666;
      font-size: 0.9em;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 Ежедневный отчет по звонкам</h1>
    <p><strong>Дата:</strong> ${date}</p>
    
    ${queues && queues.length > 0 ? `
    <h2>📞 Статистика по очередям</h2>
    <div class="stats-grid">
      ${queues.map(queue => `
        <div class="stat-card">
          <div class="stat-label">Очередь ${queue.name}</div>
          <div class="stat-value">${formatNumber(queue.totalCalls)}</div>
          <div class="stat-description">
            Принято: ${formatNumber(queue.answeredCalls)} (${queue.answerRate}%)<br>
            Пропущено: ${formatNumber(queue.abandonedCalls)}<br>
            Не обработано: ${formatNumber(queue.noCallbacks)}
          </div>
        </div>
      `).join('')}
    </div>
    ` : ''}
    
    ${inbound ? `
    <h2>📥 Входящие звонки</h2>
    <div class="stats-grid">
      <div class="stat-card success">
        <div class="stat-label">Всего звонков</div>
        <div class="stat-value">${formatNumber(inbound.totalCalls)}</div>
        <div class="stat-description">За выбранный период</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Процент ответа</div>
        <div class="stat-value">${inbound.answerRate}%</div>
        <div class="stat-description">${formatNumber(inbound.answeredCalls)} из ${formatNumber(inbound.totalCalls)} принято</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">Пропущенные звонки</div>
        <div class="stat-value">${formatNumber(inbound.abandonedCalls)}</div>
        <div class="stat-description">${inbound.abandonRate}% от общего числа</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Перезвонил сам</div>
        <div class="stat-value">${formatNumber(inbound.clientCallbacks)}</div>
        <div class="stat-description">Клиент перезвонил</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Перезвонили мы</div>
        <div class="stat-value">${formatNumber(inbound.agentCallbacks)}</div>
        <div class="stat-description">Агент перезвонил</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">Не обработан</div>
        <div class="stat-value">${formatNumber(inbound.noCallbacks)}</div>
        <div class="stat-description">Без перезвона</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Среднее время разговора</div>
        <div class="stat-value">${formatTime(inbound.avgDuration)}</div>
        <div class="stat-description">Длительность принятых звонков</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Пиковый час</div>
        <div class="stat-value">${inbound.peakHour}</div>
        <div class="stat-description">Максимальная нагрузка</div>
      </div>
    </div>
    ` : ''}
    
    ${outbound ? `
    <h2>📤 Исходящие звонки</h2>
    <div class="stats-grid">
      <div class="stat-card success">
        <div class="stat-label">Всего звонков</div>
        <div class="stat-value">${formatNumber(outbound.totalCalls)}</div>
        <div class="stat-description">За выбранный период</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Процент ответа</div>
        <div class="stat-value">${outbound.answerRate}%</div>
        <div class="stat-description">${formatNumber(outbound.answeredCalls)} из ${formatNumber(outbound.totalCalls)} принято</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">Пропущенные звонки</div>
        <div class="stat-value">${formatNumber(outbound.abandonedCalls)}</div>
        <div class="stat-description">${outbound.abandonRate}% от общего числа</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Среднее время разговора</div>
        <div class="stat-value">${formatTime(outbound.avgDuration)}</div>
        <div class="stat-description">Длительность принятых звонков</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Пиковый час</div>
        <div class="stat-value">${outbound.peakHour}</div>
        <div class="stat-description">Максимальная нагрузка</div>
      </div>
    </div>
    ` : ''}
    
    <div class="footer">
      <p>Это автоматически сгенерированный отчет системы Asterisk Queue Analytics</p>
      <p>Сгенерировано: ${(() => {
        if (generationDate) return generationDate;
        // Fallback: вычисляем текущую дату с учетом часового пояса из настроек
        const settingsDb = require('./settings-db');
        function getTZ() {
          try {
            const settings = settingsDb.getAllSettings();
            return settings.TZ || 'Europe/Moscow';
          } catch (err) {
            return process.env.TZ || 'Europe/Moscow';
          }
        }
        function getOffset(tz) {
          const offsets = {
            'Europe/Moscow': 3, 'Europe/Kiev': 2, 'Europe/Kyiv': 2, 'Europe/Minsk': 3,
            'Asia/Yekaterinburg': 5, 'Asia/Krasnoyarsk': 7, 'Asia/Irkutsk': 8,
            'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10, 'Europe/London': 0,
            'Europe/Paris': 1, 'Europe/Berlin': 1, 'America/New_York': -5,
            'America/Los_Angeles': -8, 'Asia/Tashkent': 5, 'Asia/Almaty': 6
          };
          if (offsets[tz]) return offsets[tz];
          if (tz.includes('Moscow') || tz.includes('Minsk')) return 3;
          if (tz.includes('Kiev') || tz.includes('Kyiv') || tz.includes('EET')) return 2;
          if (tz.includes('London') || tz.includes('UTC')) return 0;
          return 0;
        }
        const tz = getTZ();
        const offset = getOffset(tz);
        const now = new Date();
        const localNow = new Date(now.getTime() + (offset * 60 * 60 * 1000));
        return format(localNow, 'dd.MM.yyyy HH:mm:ss', { locale: ru });
      })()}</p>
    </div>
  </div>
</body>
</html>
  `;
  
  return html;
}

// Функция отправки ежедневного отчета
async function sendDailyReport(reportData) {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('📧 Email отправка отключена (нет конфигурации SMTP)');
    return { success: false, error: 'SMTP not configured' };
  }

  const recipients = process.env.EMAIL_RECIPIENTS;
  if (!recipients) {
    console.warn('⚠️ EMAIL_RECIPIENTS not configured. No recipients specified.');
    return { success: false, error: 'No recipients specified' };
  }

  const recipientList = recipients.split(',').map(email => email.trim());

  try {
    const html = generateEmailTemplate(reportData);
    const subject = `📊 Ежедневный отчет по звонкам - ${reportData.date}`;

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'Asterisk Analytics'}" <${process.env.SMTP_USER}>`,
      to: recipientList.join(', '),
      subject: subject,
      html: html,
      text: `Ежедневный отчет по звонкам за ${reportData.date}. Откройте письмо в HTML формате для просмотра.`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Email отчет успешно отправлен:', info.messageId);
    console.log('📧 Получатели:', recipientList.join(', '));
    
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('❌ Ошибка отправки email отчета:', error);
    return { success: false, error: error.message };
  }
}

// Функция генерации ежедневного отчета
// Принимает функции из app.js как параметры
async function generateDailyReport(pool, date, callFunctions) {
  const {
    getQueueCalls,
    getInboundCalls,
    getOutboundCalls,
    checkCallbacksBatch,
    checkCallbacksBatchInbound,
    calculateStats
  } = callFunctions;

  const startTime = `${date} 00:00:00`;
  const endTime = `${date} 23:59:59`;
  
  // Получаем текущую дату и время с учетом часового пояса из настроек
  const settingsDb = require('./settings-db');
  function getTimezoneLocal() {
    try {
      const settings = settingsDb.getAllSettings();
      return settings.TZ || 'Europe/Moscow';
    } catch (err) {
      return process.env.TZ || 'Europe/Moscow';
    }
  }
  function getTimezoneOffsetLocal(timezone) {
    const timezoneOffsets = {
      'Europe/Moscow': 3, 'Europe/Kiev': 2, 'Europe/Kyiv': 2, 'Europe/Minsk': 3,
      'Asia/Yekaterinburg': 5, 'Asia/Krasnoyarsk': 7, 'Asia/Irkutsk': 8,
      'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10, 'Europe/London': 0,
      'Europe/Paris': 1, 'Europe/Berlin': 1, 'America/New_York': -5,
      'America/Los_Angeles': -8, 'Asia/Tashkent': 5, 'Asia/Almaty': 6
    };
    if (timezoneOffsets.hasOwnProperty(timezone)) {
      return timezoneOffsets[timezone];
    }
    if (timezone.includes('Moscow') || timezone.includes('Minsk')) return 3;
    if (timezone.includes('Kiev') || timezone.includes('Kyiv') || timezone.includes('EET')) return 2;
    if (timezone.includes('London') || timezone.includes('UTC')) return 0;
    return 0;
  }
  const timezone = getTimezoneLocal();
  const offsetHours = getTimezoneOffsetLocal(timezone);
  const now = new Date();
  const nowInLocalTZ = new Date(now.getTime() + (offsetHours * 60 * 60 * 1000));
  const generationDate = format(nowInLocalTZ, 'dd.MM.yyyy HH:mm:ss', { locale: ru });
  
  const reportData = {
    date: format(new Date(date), 'dd.MM.yyyy', { locale: ru }),
    generationDate: generationDate,
    queues: [],
    inbound: null,
    outbound: null
  };

  try {
    // Получаем список всех очередей
    const [queues] = await dbExecute(`
      SELECT DISTINCT queuename 
      FROM asteriskcdrdb.queuelog 
      WHERE queuename IS NOT NULL AND queuename != 'NONE'
      ORDER BY queuename
    `);

    // Статистика по каждой очереди (параллельная обработка для ускорения)
    const queueStatsPromises = queues.map(async (queueRow) => {
      const queueName = queueRow.queuename;
      const calls = await getQueueCalls(pool, queueName, startTime, endTime);
      
      // Проверяем перезвоны для очередей
      const abandonedCalls = [];
      for (let i = 0; i < calls.length; i++) {
        const isAbandoned = calls[i].status === 'abandoned' || 
                            (calls[i].duration && parseInt(calls[i].duration) <= 5) ||
                            (!calls[i].connectTime && calls[i].endTime && calls[i].status !== 'completed_by_agent' && calls[i].status !== 'completed_by_caller');
        if (isAbandoned) {
          abandonedCalls.push({ index: i, call: calls[i] });
        }
      }
      
      if (abandonedCalls.length > 0) {
        const callbacks = await checkCallbacksBatch(pool, abandonedCalls.map(ac => ac.call), queueName);
        abandonedCalls.forEach(({ index }, idx) => {
          const callback = callbacks[idx];
          if (callback) {
            calls[index].callbackStatus = callback.status;
          } else {
            calls[index].callbackStatus = 'Не обработан';
          }
        });
      }
      
      const stats = calculateStats(calls, 'queue');
      return {
        name: queueName,
        ...stats
      };
    });
    
    // Ждем завершения обработки всех очередей
    const queueStats = await Promise.all(queueStatsPromises);
    reportData.queues = queueStats;

    // Статистика по входящим звонкам
    const inboundCalls = await getInboundCalls(pool, startTime, endTime);
    
    // Проверяем перезвоны для входящих
    const inboundAbandoned = [];
    for (let i = 0; i < inboundCalls.length; i++) {
      const isAbandoned = inboundCalls[i].status === 'no_answer' || 
                          inboundCalls[i].status === 'busy' || 
                          inboundCalls[i].status === 'failed' ||
                          (inboundCalls[i].duration && parseInt(inboundCalls[i].duration) <= 5);
      if (isAbandoned) {
        inboundAbandoned.push({ index: i, call: inboundCalls[i] });
      }
    }
    
    if (inboundAbandoned.length > 0) {
      const callbacks = await checkCallbacksBatchInbound(pool, inboundAbandoned.map(ac => ac.call));
      inboundAbandoned.forEach(({ index }, idx) => {
        const callback = callbacks[idx];
        if (callback) {
          inboundCalls[index].callbackStatus = callback.status;
        } else {
          inboundCalls[index].callbackStatus = 'Не обработан';
        }
      });
    }
    
    const inboundStats = calculateStats(inboundCalls, 'inbound');
    reportData.inbound = inboundStats;

    // Статистика по исходящим звонкам
    const outboundCalls = await getOutboundCalls(pool, startTime, endTime);
    const outboundStats = calculateStats(outboundCalls, 'outbound');
    reportData.outbound = outboundStats;

    return reportData;
  } catch (error) {
    console.error('Ошибка генерации ежедневного отчета:', error);
    throw error;
  }
}

// Генерация HTML шаблона для отчета по конкретной очереди
function generateQueueEmailTemplate(reportData) {
  const { date, generationDate, queue_name, stats } = reportData;
  
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    
    // Преобразуем в число, если это строка
    const sec = typeof seconds === 'string' ? parseInt(seconds, 10) : Number(seconds);
    
    // Проверяем на разумность значения (не больше 2 часов = 7200 секунд)
    if (isNaN(sec) || sec < 0 || sec > 7200) {
      return '0:00';
    }
    
    const mins = Math.floor(sec / 60);
    const remainingSecs = sec % 60;
    return `${mins}:${remainingSecs < 10 ? '0' : ''}${remainingSecs}`;
  };

  const formatNumber = (num) => {
    return num ? num.toLocaleString('ru-RU') : '0';
  };

  let html = `
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ежедневный отчет по очереди ${queue_name} - ${date}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #f5f5f5;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 30px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 {
      color: #0061a6;
      border-bottom: 3px solid #0061a6;
      padding-bottom: 10px;
      margin-bottom: 30px;
    }
    h2 {
      color: #535f70;
      margin-top: 30px;
      margin-bottom: 15px;
      font-size: 1.3em;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin: 20px 0;
    }
    .stat-card {
      background: #f8f9fa;
      border-left: 4px solid #0061a6;
      padding: 15px;
      border-radius: 4px;
    }
    .stat-card.success {
      border-left-color: #4caf50;
    }
    .stat-card.danger {
      border-left-color: #f44336;
    }
    .stat-card.warning {
      border-left-color: #ff9800;
    }
    .stat-label {
      font-size: 0.85em;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }
    .stat-value {
      font-size: 2em;
      font-weight: bold;
      color: #333;
    }
    .stat-description {
      font-size: 0.9em;
      color: #666;
      margin-top: 5px;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #ddd;
      color: #666;
      font-size: 0.9em;
      text-align: center;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      background: white;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    th {
      background: #0061a6;
      color: white;
      font-weight: 600;
      padding: 12px;
      text-align: left;
    }
    td {
      padding: 10px 12px;
      border-bottom: 1px solid #ddd;
    }
    tr:hover {
      background: #f5f5f5;
    }
    .summary-box {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 25px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .summary-box h3 {
      margin: 0 0 15px 0;
      font-size: 1.2em;
    }
    .summary-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin-top: 15px;
    }
    .summary-stat {
      text-align: center;
    }
    .summary-stat-value {
      font-size: 2em;
      font-weight: bold;
      margin: 5px 0;
    }
    .summary-stat-label {
      font-size: 0.85em;
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📞 Ежедневный отчет по очереди ${queue_name}</h1>
    
    <!-- Сводная информация -->
    <div class="summary-box">
      <h3>📅 Сводка за ${date}</h3>
      <div class="summary-stats">
        <div class="summary-stat">
          <div class="summary-stat-value">${formatNumber(stats.totalCalls)}</div>
          <div class="summary-stat-label">Всего звонков</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${stats.answerRate}%</div>
          <div class="summary-stat-label">Процент ответа</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${stats.abandonRate !== undefined ? stats.abandonRate : 0}%</div>
          <div class="summary-stat-label">Abandon Rate</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${stats.slaRate}%</div>
          <div class="summary-stat-label">SLA (20 сек)</div>
        </div>
      </div>
    </div>
    
    <!-- Сводная информация -->
    <div class="summary-box">
      <h3>📅 Сводка за ${date}</h3>
      <div class="summary-stats">
        <div class="summary-stat">
          <div class="summary-stat-value">${formatNumber(stats.totalCalls)}</div>
          <div class="summary-stat-label">Всего звонков</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${stats.answerRate}%</div>
          <div class="summary-stat-label">Процент ответа</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${stats.abandonRate !== undefined ? stats.abandonRate : 0}%</div>
          <div class="summary-stat-label">Abandon Rate</div>
        </div>
        <div class="summary-stat">
          <div class="summary-stat-value">${stats.slaRate}%</div>
          <div class="summary-stat-label">SLA (20 сек)</div>
        </div>
      </div>
    </div>
    
    <!-- Ключевые метрики -->
    <h2>📊 Ключевые показатели</h2>
    <div class="stats-grid">
      <div class="stat-card success">
        <div class="stat-label">Всего звонков</div>
        <div class="stat-value">${formatNumber(stats.totalCalls)}</div>
        <div class="stat-description">За выбранный период</div>
      </div>
      <div class="stat-card success">
        <div class="stat-label">Процент ответа</div>
        <div class="stat-value">${stats.answerRate}%</div>
        <div class="stat-description">${formatNumber(stats.answeredCalls)} из ${formatNumber(stats.totalCalls)} принято</div>
      </div>
      <div class="stat-card warning">
        <div class="stat-label">SLA (20 сек)</div>
        <div class="stat-value">${stats.slaRate}%</div>
        <div class="stat-description">Принято в первые 20 сек</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">Пропущенные звонки</div>
        <div class="stat-value">${formatNumber(stats.abandonedCalls)}</div>
        <div class="stat-description">${stats.totalCalls > 0 ? Math.round(stats.abandonedCalls / stats.totalCalls * 100) : 0}% от общего числа</div>
      </div>
      ${stats.asa ? `
      <div class="stat-card">
        <div class="stat-label">ASA (Среднее время ответа)</div>
        <div class="stat-value">${formatTime(stats.asa)}</div>
        <div class="stat-description">Average Speed of Answer</div>
      </div>
      ` : ''}
      ${stats.abandonRate !== undefined ? `
      <div class="stat-card danger">
        <div class="stat-label">Abandon Rate</div>
        <div class="stat-value">${stats.abandonRate}%</div>
        <div class="stat-description">Процент пропущенных</div>
      </div>
      ` : ''}
    </div>
    
    <!-- Детальная таблица метрик -->
    <h2>📈 Детальные метрики</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: white;">
      <thead>
        <tr style="background: #0061a6; color: white;">
          <th style="padding: 12px; text-align: left;">Метрика</th>
          <th style="padding: 12px; text-align: right;">Значение</th>
          <th style="padding: 12px; text-align: left;">Описание</th>
        </tr>
      </thead>
      <tbody>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 10px; font-weight: 600;">Принятые звонки</td>
          <td style="padding: 10px; text-align: right;">${formatNumber(stats.answeredCalls)}</td>
          <td style="padding: 10px; color: #666;">Успешно обработанные звонки</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd; background: #f9f9f9;">
          <td style="padding: 10px; font-weight: 600;">Среднее время ожидания</td>
          <td style="padding: 10px; text-align: right;">${formatTime(stats.avgWaitTimeAnswered || stats.avgWaitTime || 0)}</td>
          <td style="padding: 10px; color: #666;">Для отвеченных звонков</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 10px; font-weight: 600;">Среднее время разговора</td>
          <td style="padding: 10px; text-align: right;">${formatTime(stats.avgDuration || 0)}</td>
          <td style="padding: 10px; color: #666;">Длительность принятых звонков</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd; background: #f9f9f9;">
          <td style="padding: 10px; font-weight: 600;">Среднее время в очереди</td>
          <td style="padding: 10px; text-align: right;">${stats.avgQueueTime || 0} сек</td>
          <td style="padding: 10px; color: #666;">Для всех звонков</td>
        </tr>
        <tr style="border-bottom: 1px solid #ddd;">
          <td style="padding: 10px; font-weight: 600;">Пиковый час</td>
          <td style="padding: 10px; text-align: right;">${stats.peakHour || '-'}</td>
          <td style="padding: 10px; color: #666;">Максимальная нагрузка (${formatNumber(stats.peakHourCalls || 0)} звонков)</td>
        </tr>
        ${stats.slaCalls !== undefined ? `
        <tr style="border-bottom: 1px solid #ddd; background: #f9f9f9;">
          <td style="padding: 10px; font-weight: 600;">Звонки в пределах SLA</td>
          <td style="padding: 10px; text-align: right;">${formatNumber(stats.slaCalls)}</td>
          <td style="padding: 10px; color: #666;">Принято в первые 20 секунд</td>
        </tr>
        ` : ''}
      </tbody>
    </table>
    
    <!-- Статистика перезвонов -->
    <h2>↩️ Статистика перезвонов</h2>
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Перезвонил сам</div>
        <div class="stat-value">${formatNumber(stats.clientCallbacks || 0)}</div>
        <div class="stat-description">Клиент перезвонил самостоятельно</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Перезвонили мы</div>
        <div class="stat-value">${formatNumber(stats.agentCallbacks || 0)}</div>
        <div class="stat-description">Агент перезвонил клиенту</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">Не обработан</div>
        <div class="stat-value">${formatNumber(stats.noCallbacks || 0)}</div>
        <div class="stat-description">Пропущенные без перезвона</div>
      </div>
      ${stats.abandonedCalls > 0 ? `
      <div class="stat-card">
        <div class="stat-label">Обработано перезвонов</div>
        <div class="stat-value">${formatNumber((stats.clientCallbacks || 0) + (stats.agentCallbacks || 0))}</div>
        <div class="stat-description">${stats.abandonedCalls > 0 ? Math.round(((stats.clientCallbacks || 0) + (stats.agentCallbacks || 0)) / stats.abandonedCalls * 100) : 0}% от пропущенных</div>
      </div>
      ` : ''}
    </div>
    
    <!-- Распределение звонков по часам -->
    ${stats.callsByHour && Object.keys(stats.callsByHour).length > 0 ? `
    <h2>🕐 Распределение звонков по часам</h2>
    <table style="width: 100%; border-collapse: collapse; margin: 20px 0; background: white;">
      <thead>
        <tr style="background: #0061a6; color: white;">
          <th style="padding: 12px; text-align: left;">Час</th>
          <th style="padding: 12px; text-align: right;">Количество звонков</th>
          <th style="padding: 12px; text-align: right;">% от общего</th>
          <th style="padding: 12px; text-align: center; width: 200px;">Визуализация</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(stats.callsByHour)
          .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
          .map(([hour, count], idx) => {
            const percent = stats.totalCalls > 0 ? Math.round((count / stats.totalCalls) * 100) : 0;
            const barWidth = Math.max(5, (percent / 100) * 180);
            const isPeak = stats.peakHour && hour === stats.peakHour.toString().split(':')[0];
            return `
            <tr style="border-bottom: 1px solid #ddd; ${idx % 2 === 0 ? 'background: #f9f9f9;' : ''} ${isPeak ? 'background: #fff3cd !important;' : ''}">
              <td style="padding: 10px; font-weight: ${isPeak ? '600' : 'normal'};">
                ${hour.padStart(2, '0')}:00${isPeak ? ' ⭐ Пик' : ''}
              </td>
              <td style="padding: 10px; text-align: right; font-weight: 600;">${formatNumber(count)}</td>
              <td style="padding: 10px; text-align: right;">${percent}%</td>
              <td style="padding: 10px;">
                <div style="width: 180px; height: 20px; background: #e0e0e0; border-radius: 10px; position: relative; overflow: hidden;">
                  <div style="width: ${barWidth}px; height: 100%; background: ${isPeak ? '#ff9800' : '#0061a6'}; border-radius: 10px; transition: width 0.3s;"></div>
                </div>
              </td>
            </tr>
          `;
          }).join('')}
      </tbody>
    </table>
    ` : ''}
    
    <div class="footer">
      <p>Это автоматически сгенерированный отчет системы Asterisk Queue Analytics</p>
      <p>Сгенерировано: ${(() => {
        if (generationDate) return generationDate;
        // Fallback: вычисляем текущую дату с учетом часового пояса из настроек
        const settingsDb = require('./settings-db');
        function getTZ() {
          try {
            const settings = settingsDb.getAllSettings();
            return settings.TZ || 'Europe/Moscow';
          } catch (err) {
            return process.env.TZ || 'Europe/Moscow';
          }
        }
        function getOffset(tz) {
          const offsets = {
            'Europe/Moscow': 3, 'Europe/Kiev': 2, 'Europe/Kyiv': 2, 'Europe/Minsk': 3,
            'Asia/Yekaterinburg': 5, 'Asia/Krasnoyarsk': 7, 'Asia/Irkutsk': 8,
            'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10, 'Europe/London': 0,
            'Europe/Paris': 1, 'Europe/Berlin': 1, 'America/New_York': -5,
            'America/Los_Angeles': -8, 'Asia/Tashkent': 5, 'Asia/Almaty': 6
          };
          if (offsets[tz]) return offsets[tz];
          if (tz.includes('Moscow') || tz.includes('Minsk')) return 3;
          if (tz.includes('Kiev') || tz.includes('Kyiv') || tz.includes('EET')) return 2;
          if (tz.includes('London') || tz.includes('UTC')) return 0;
          return 0;
        }
        const tz = getTZ();
        const offset = getOffset(tz);
        const now = new Date();
        const localNow = new Date(now.getTime() + (offset * 60 * 60 * 1000));
        return format(localNow, 'dd.MM.yyyy HH:mm:ss', { locale: ru });
      })()}</p>
    </div>
  </div>
</body>
</html>
  `;
  
  return html;
}

// Функция генерации Excel файла со списком звонков
function generateExcelFile(calls, queueName, dateRange, timezone, offsetHours) {
  if (!calls || calls.length === 0) {
    return null;
  }

  // Фильтруем только входящие звонки (статус abandoned или completed_by_caller/completed_by_agent)
  const inboundCalls = calls.filter(call => {
    const status = call.status || '';
    return status === 'abandoned' || 
           status === 'completed_by_caller' || 
           status === 'completed_by_agent';
  });

  // Форматируем дату и время
  // ВАЖНО: Данные в MySQL уже хранятся в локальном времени (Europe/Moscow)
  // Поэтому НЕ нужно добавлять смещение таймзоны
  const formatDateTime = (dateString) => {
    if (!dateString) return '';
    const str = dateString.toString();
    // Если строка формата "YYYY-MM-DD HH:MM:SS"
    const match = str.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):?(\d{2})?/);
    if (match) {
      return `${match[3]}.${match[2]}.${match[1]} ${match[4]}:${match[5]}:${match[6] || '00'}`;
    }
    // Если это Date объект - извлекаем компоненты напрямую (без преобразования таймзоны)
    if (dateString instanceof Date) {
      const day = String(dateString.getDate()).padStart(2, '0');
      const month = String(dateString.getMonth() + 1).padStart(2, '0');
      const year = dateString.getFullYear();
      const hours = String(dateString.getHours()).padStart(2, '0');
      const minutes = String(dateString.getMinutes()).padStart(2, '0');
      const seconds = String(dateString.getSeconds()).padStart(2, '0');
      return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
    }
    return '';
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '0 сек';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins} мин ${secs} сек` : `${secs} сек`;
  };

  const getStatusText = (status) => {
    if (status === 'abandoned') return 'Пропущен';
    if (status === 'completed_by_caller') return 'Принят (завершен абонентом)';
    if (status === 'completed_by_agent') return 'Принят (завершен агентом)';
    return status || '-';
  };

  // Подготовка данных для Excel
  const excelData = inboundCalls.map(call => ({
    'Дата и время': formatDateTime(call.startTime),
    'Номер абонента': call.clientNumber || '-',
    'Время ожидания': call.waitTime ? `${call.waitTime} сек` : '0 сек',
    'Длительность': formatDuration(call.duration),
    'Статус': getStatusText(call.status),
    'Запись': call.recordingFile || '-',
    'Перезвон': call.callbackStatus || 'Не обработан',
    'Агент': call.agent || '-'
  }));

  // Проверяем наличие пропущенных звонков
  const abandonedCalls = inboundCalls.filter(call => call.status === 'abandoned');
  if (abandonedCalls.length === 0) {
    // Добавляем строку о том, что пропущенные отсутствуют
    excelData.push({
      'Дата и время': '',
      'Номер абонента': '',
      'Время ожидания': '',
      'Длительность': '',
      'Статус': 'отсутствуют пропущенные',
      'Запись': '',
      'Перезвон': '',
      'Агент': ''
    });
  }

  // Создание книги Excel
  const wb = XLSX.utils.book_new();
  
  // Создаем лист с заголовками и данными
  // Сначала создаем пустой лист с заголовком
  const headerData = [
    [`Очередь: ${queueName}`],
    [`Период: ${dateRange}`],
    [], // Пустая строка
    ['Дата и время', 'Номер абонента', 'Время ожидания', 'Длительность', 'Статус', 'Запись', 'Перезвон', 'Агент']
  ];
  
  // Добавляем данные звонков
  const sheetData = [
    ...headerData,
    ...excelData.map(call => [
      call['Дата и время'],
      call['Номер абонента'],
      call['Время ожидания'],
      call['Длительность'],
      call['Статус'],
      call['Запись'],
      call['Перезвон'],
      call['Агент']
    ])
  ];
  
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Настройка ширины столбцов
  const colWidths = [
    { wch: 20 }, // Дата и время
    { wch: 18 }, // Номер абонента
    { wch: 15 }, // Время ожидания
    { wch: 18 }, // Длительность
    { wch: 30 }, // Статус
    { wch: 40 }, // Запись
    { wch: 20 }, // Перезвон
    { wch: 15 }  // Агент
  ];
  ws['!cols'] = colWidths;

  // Объединяем ячейки для заголовка
  if (!ws['!merges']) ws['!merges'] = [];
  ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }); // Объединяем первую строку (Очередь)
  ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: 7 } }); // Объединяем вторую строку (Период)

  XLSX.utils.book_append_sheet(wb, ws, 'Входящие звонки');

  // Генерация файла в буфер
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return buffer;
}

// Функция генерации отчета для конкретной очереди
async function generateQueueReport(pool, queueName, date, startTimeUTC, endTimeUTC, callFunctions) {
  const {
    getQueueCalls,
    getQueueCallsUltraFast,
    getQueueCallsOptimized,
    getQueueCallsParallel,
    checkCallbacksBatch,
    calculateStats
  } = callFunctions || {};

  // Используем переданные startTimeUTC и endTimeUTC, которые уже конвертированы в UTC
  // Если не переданы, используем старую логику (для обратной совместимости)
  const startTime = startTimeUTC || `${date} 00:00:00`;
  const endTime = endTimeUTC || `${date} 23:59:59`;
  
  try {
    // Используем те же функции и оптимизации, что и в веб-интерфейсе для консистентности данных
    const USE_ULTRA_FAST_QUERIES = process.env.USE_ULTRA_FAST_QUERIES !== 'false';
    const USE_PARALLEL_QUERIES = process.env.USE_PARALLEL_QUERIES !== 'false';
    const USE_LARGE_DATA_OPTIMIZATION = process.env.USE_LARGE_DATA_OPTIMIZATION === 'true';
    
    let calls;
    // Используем те же оптимизации, что и в веб-интерфейсе
    if (USE_ULTRA_FAST_QUERIES && typeof getQueueCallsUltraFast === 'function') {
      calls = await getQueueCallsUltraFast(queueName, startTime, endTime);
    } else if (USE_LARGE_DATA_OPTIMIZATION && typeof getQueueCallsOptimized === 'function') {
      calls = await getQueueCallsOptimized(queueName, startTime, endTime);
    } else if (USE_PARALLEL_QUERIES && typeof getQueueCallsParallel === 'function') {
      calls = await getQueueCallsParallel(queueName, startTime, endTime);
    } else {
      // Передаем null - функция использует dbExecute
      calls = await getQueueCalls(null, queueName, startTime, endTime);
    }
    
    // Используем ту же логику обработки перезвонов, что и в веб-интерфейсе
    const abandonedCalls = [];
    calls.forEach((call, i) => {
      const isAbandoned = call.status === 'abandoned' || 
                          (call.duration && parseInt(call.duration) <= 5) ||
                          (!call.connectTime && call.endTime && call.status !== 'completed_by_agent' && call.status !== 'completed_by_caller');
      
      if (isAbandoned) {
        abandonedCalls.push({ index: i, call });
      }
    });
    
    // Оптимизированная проверка перезвонов - batch-запрос (как в веб-интерфейсе)
    if (abandonedCalls.length > 0) {
      // Передаем null - функция использует dbExecute
      const callbacks = await checkCallbacksBatch(null, abandonedCalls.map(ac => ac.call), queueName);
      
      // Применяем результаты (оптимизировано, как в веб-интерфейсе)
      callbacks.forEach((callback, idx) => {
        const { index } = abandonedCalls[idx];
        if (callback) {
          calls[index].callback = callback;
          calls[index].callbackStatus = callback.status;
          if (callback.recordingFile) {
            calls[index].recordingFile = callback.recordingFile;
          }
        } else {
          calls[index].callbackStatus = 'Не обработан';
        }
      });
    }
    
    const stats = calculateStats(calls, 'queue');
    
    // Форматируем дату для отображения (date уже в UTC, но для отображения используем локальное время)
    // Используем функции из app.js для получения часового пояса
    // ВАЖНО: Это создает циклическую зависимость, поэтому определяем функции локально
    const settingsDb = require('./settings-db');
    function getTimezoneLocal() {
      try {
        const settings = settingsDb.getAllSettings();
        return settings.TZ || 'Europe/Moscow';
      } catch (err) {
        return process.env.TZ || 'Europe/Moscow';
      }
    }
    function getTimezoneOffsetLocal(timezone) {
      const timezoneOffsets = {
        'Europe/Moscow': 3, 'Europe/Kiev': 2, 'Europe/Kyiv': 2, 'Europe/Minsk': 3,
        'Asia/Yekaterinburg': 5, 'Asia/Krasnoyarsk': 7, 'Asia/Irkutsk': 8,
        'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10, 'Europe/London': 0,
        'Europe/Paris': 1, 'Europe/Berlin': 1, 'America/New_York': -5,
        'America/Los_Angeles': -8, 'Asia/Tashkent': 5, 'Asia/Almaty': 6
      };
      if (timezoneOffsets.hasOwnProperty(timezone)) {
        return timezoneOffsets[timezone];
      }
      if (timezone.includes('Moscow') || timezone.includes('Minsk')) return 3;
      if (timezone.includes('Kiev') || timezone.includes('Kyiv') || timezone.includes('EET')) return 2;
      if (timezone.includes('London') || timezone.includes('UTC')) return 0;
      return 0;
    }
    
    const timezone = getTimezoneLocal();
    const offsetHours = getTimezoneOffsetLocal(timezone);
    
    const dateObj = new Date(date + ' 12:00:00');
    const localDateObj = new Date(dateObj.getTime() + (offsetHours * 60 * 60 * 1000));
    const displayDate = format(localDateObj, 'dd.MM.yyyy', { locale: ru });
    
    // Текущая дата и время с учетом часового пояса для даты генерации
    const now = new Date();
    const nowInLocalTZ = new Date(now.getTime() + (offsetHours * 60 * 60 * 1000));
    const generationDate = format(nowInLocalTZ, 'dd.MM.yyyy HH:mm:ss', { locale: ru });
    
    // Формируем диапазон дат для Excel заголовка
    // startTime и endTime в формате 'yyyy-MM-dd HH:mm:ss' (UTC)
    // Конвертируем в локальное время для отображения
    const startTimeUTC = new Date(startTime + 'Z'); // Добавляем Z для указания UTC
    const endTimeUTC = new Date(endTime + 'Z');
    const startTimeLocal = new Date(startTimeUTC.getTime() + (offsetHours * 60 * 60 * 1000));
    const endTimeLocal = new Date(endTimeUTC.getTime() + (offsetHours * 60 * 60 * 1000));
    const dateRange = `${format(startTimeLocal, 'dd.MM.yyyy HH:mm', { locale: ru })} - ${format(endTimeLocal, 'dd.MM.yyyy HH:mm', { locale: ru })}`;
    
    return {
      date: displayDate, // Дата отчета для отображения в локальном времени
      generationDate: generationDate, // Текущая дата и время генерации с учетом часового пояса
      queue_name: queueName,
      stats,
      calls: calls, // Добавляем массив звонков для Excel файла
      dateRange: dateRange // Диапазон дат для Excel заголовка
    };
  } catch (error) {
    console.error('Ошибка генерации отчета для очереди:', error);
    throw error;
  }
}

// Функция отправки отчета для конкретной очереди
async function sendQueueReport(reportData, queueName, pool) {
  const transporter = createTransporter();
  
  if (!transporter) {
    console.log('📧 Email отправка отключена (нет конфигурации SMTP)');
    return { success: false, error: 'SMTP not configured' };
  }

  // Получаем email адреса для этой очереди из базы данных
  try {
    const emailRows = await settingsDb.getAll(`
      SELECT email
      FROM email_reports
      WHERE queue_name = ? AND is_active = 1
    `, [queueName]);

    if (!emailRows || emailRows.length === 0) {
      console.log(`📧 Нет активных email адресов для очереди ${queueName}`);
      return { success: false, error: 'No active email addresses for this queue' };
    }

    const recipientList = emailRows.map(row => row.email);

    const html = generateQueueEmailTemplate(reportData);
    const subject = `📞 Ежедневный отчет по очереди ${queueName} - ${reportData.date}`;

    // Получаем настройки часового пояса для генерации Excel
    const settingsDbLocal = require('./settings-db');
    function getTimezoneLocal() {
      try {
        const settings = settingsDbLocal.getAllSettings();
        return settings.TZ || 'Europe/Moscow';
      } catch (err) {
        return process.env.TZ || 'Europe/Moscow';
      }
    }
    function getTimezoneOffsetLocal(timezone) {
      const timezoneOffsets = {
        'Europe/Moscow': 3, 'Europe/Kiev': 2, 'Europe/Kyiv': 2, 'Europe/Minsk': 3,
        'Asia/Yekaterinburg': 5, 'Asia/Krasnoyarsk': 7, 'Asia/Irkutsk': 8,
        'Asia/Yakutsk': 9, 'Asia/Vladivostok': 10, 'Europe/London': 0,
        'Europe/Paris': 1, 'Europe/Berlin': 1, 'America/New_York': -5,
        'America/Los_Angeles': -8, 'Asia/Tashkent': 5, 'Asia/Almaty': 6
      };
      if (timezoneOffsets.hasOwnProperty(timezone)) {
        return timezoneOffsets[timezone];
      }
      if (timezone.includes('Moscow') || timezone.includes('Minsk')) return 3;
      if (timezone.includes('Kiev') || timezone.includes('Kyiv') || timezone.includes('EET')) return 2;
      if (timezone.includes('London') || timezone.includes('UTC')) return 0;
      return 0;
    }
    
    const timezone = getTimezoneLocal();
    const offsetHours = getTimezoneOffsetLocal(timezone);
    
    // Формируем диапазон дат для заголовка Excel (используем из reportData, если есть, иначе только дату)
    const dateRange = reportData.dateRange || reportData.date;

    // Генерируем Excel файл со списком звонков
    let attachments = [];
    if (reportData.calls && reportData.calls.length > 0) {
      try {
        const excelBuffer = generateExcelFile(reportData.calls, queueName, dateRange, timezone, offsetHours);
        if (excelBuffer) {
          attachments.push({
            filename: `Входящие_звонки_${queueName}_${dateRange.replace(/\./g, '_')}.xlsx`,
            content: excelBuffer
          });
          console.log(`📊 Excel файл со списком звонков создан для очереди ${queueName}`);
        }
      } catch (excelError) {
        console.error('❌ Ошибка генерации Excel файла:', excelError);
        // Продолжаем отправку email даже если Excel не удалось создать
      }
    }

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'Asterisk Analytics'}" <${process.env.SMTP_USER}>`,
      to: recipientList.join(', '),
      subject: subject,
      html: html,
      text: `Ежедневный отчет по очереди ${queueName} за ${reportData.date}. Откройте письмо в HTML формате для просмотра.`,
      attachments: attachments.length > 0 ? attachments : undefined
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email отчет для очереди ${queueName} успешно отправлен:`, info.messageId);
    console.log('📧 Получатели:', recipientList.join(', '));
    if (attachments.length > 0) {
      console.log('📎 Прикреплен Excel файл со списком звонков');
    }
    
    return { success: true, messageId: info.messageId, recipients: recipientList };
  } catch (error) {
    console.error('❌ Ошибка отправки email отчета для очереди:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendDailyReport,
  generateDailyReport,
  generateQueueReport,
  sendQueueReport,
  createTransporter
};

