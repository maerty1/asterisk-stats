require('dotenv').config();
const nodemailer = require('nodemailer');
const { format, subDays } = require('date-fns');
const { ru } = require('date-fns/locale');
const { execute: dbExecute } = require('./db-optimizer');

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
  const { date, queues, inbound, outbound } = reportData;
  
  const formatTime = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
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
      <p>Сгенерировано: ${format(new Date(), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}</p>
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
  
  const reportData = {
    date: format(new Date(date), 'dd.MM.yyyy', { locale: ru }),
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
  const { date, queue_name, stats } = reportData;
  
  const formatTime = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
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
  </style>
</head>
<body>
  <div class="container">
    <h1>📞 Ежедневный отчет по очереди ${queue_name}</h1>
    <p><strong>Дата:</strong> ${date}</p>
    <p><strong>Очередь:</strong> ${queue_name}</p>
    
    <h2>📊 Статистика</h2>
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
      <div class="stat-card">
        <div class="stat-label">Перезвонил сам</div>
        <div class="stat-value">${formatNumber(stats.clientCallbacks || 0)}</div>
        <div class="stat-description">Клиент перезвонил</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Перезвонили мы</div>
        <div class="stat-value">${formatNumber(stats.agentCallbacks || 0)}</div>
        <div class="stat-description">Агент перезвонил</div>
      </div>
      <div class="stat-card danger">
        <div class="stat-label">Не обработан</div>
        <div class="stat-value">${formatNumber(stats.noCallbacks || 0)}</div>
        <div class="stat-description">Без перезвона</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Среднее ожидание</div>
        <div class="stat-value">${formatTime(stats.avgWaitTimeAnswered || stats.avgWaitTime || 0)}</div>
        <div class="stat-description">Для отвеченных звонков</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Среднее время разговора</div>
        <div class="stat-value">${formatTime(stats.avgDuration || 0)}</div>
        <div class="stat-description">Длительность принятых звонков</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Среднее время в очереди</div>
        <div class="stat-value">${stats.avgQueueTime || 0} сек</div>
        <div class="stat-description">Для всех звонков</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Пиковый час</div>
        <div class="stat-value">${stats.peakHour || '-'}</div>
        <div class="stat-description">Максимальная нагрузка</div>
      </div>
      ${stats.asa ? `
      <div class="stat-card">
        <div class="stat-label">ASA</div>
        <div class="stat-value">${formatTime(stats.asa)}</div>
        <div class="stat-description">Среднее время ответа</div>
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
    
    <div class="footer">
      <p>Это автоматически сгенерированный отчет системы Asterisk Queue Analytics</p>
      <p>Сгенерировано: ${format(new Date(), 'dd.MM.yyyy HH:mm:ss', { locale: ru })}</p>
    </div>
  </div>
</body>
</html>
  `;
  
  return html;
}

// Функция генерации отчета для конкретной очереди
async function generateQueueReport(pool, queueName, date, callFunctions) {
  const {
    getQueueCalls,
    checkCallbacksBatch,
    calculateStats
  } = callFunctions;

  const startTime = `${date} 00:00:00`;
  const endTime = `${date} 23:59:59`;
  
  try {
    const calls = await getQueueCalls(pool, queueName, startTime, endTime);
    
    // Проверяем перезвоны для очереди
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
      date: format(new Date(date), 'dd.MM.yyyy', { locale: ru }),
      queue_name: queueName,
      stats
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
    const [emailRows] = await dbExecute(`
      SELECT email
      FROM asteriskcdrdb.email_reports
      WHERE queue_name = ? AND is_active = TRUE
    `, [queueName]);

    if (!emailRows || emailRows.length === 0) {
      console.log(`📧 Нет активных email адресов для очереди ${queueName}`);
      return { success: false, error: 'No active email addresses for this queue' };
    }

    const recipientList = emailRows.map(row => row.email);

    const html = generateQueueEmailTemplate(reportData);
    const subject = `📞 Ежедневный отчет по очереди ${queueName} - ${reportData.date}`;

    const mailOptions = {
      from: `"${process.env.EMAIL_FROM_NAME || 'Asterisk Analytics'}" <${process.env.SMTP_USER}>`,
      to: recipientList.join(', '),
      subject: subject,
      html: html,
      text: `Ежедневный отчет по очереди ${queueName} за ${reportData.date}. Откройте письмо в HTML формате для просмотра.`
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email отчет для очереди ${queueName} успешно отправлен:`, info.messageId);
    console.log('📧 Получатели:', recipientList.join(', '));
    
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

