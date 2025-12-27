/**
 * Тест оптимизированных запросов
 */

require('dotenv').config();
const { getQueueCallsUltraFast, getQueueCallsSubquery } = require('./db-optimized-queue');
const { getQueueCallsParallel } = require('./db-parallel');
const { pool, execute: dbExecute } = require('./db-optimizer');

// Импортируем оригинальную функцию для сравнения
async function getQueueCalls(conn, queueName, startTime, endTime) {
  const [rows] = await conn.execute(`
    SELECT 
      q.time, q.event, q.callid, q.queuename, q.agent, 
      q.data1, q.data2, q.data3, q.data4, q.data5,
      c.recordingfile, c.linkedid
    FROM asteriskcdrdb.queuelog q
    LEFT JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid AND c.disposition = 'ANSWERED'
    WHERE q.queuename = ? 
      AND q.time BETWEEN ? AND ?
    ORDER BY q.time
  `, [queueName, startTime, endTime]);

  const calls = {};
  rows.forEach(row => {
    if (!calls[row.callid]) {
      calls[row.callid] = {
        callId: row.callid,
        events: [],
        status: 'abandoned',
        startTime: null,
        connectTime: null,
        endTime: null,
        clientNumber: null,
        queuePosition: null,
        agent: null,
        duration: null,
        waitTime: null,
        recordingFile: row.recordingfile,
        linkedid: row.linkedid
      };
    }
    
    calls[row.callid].events.push(row);
    
    if (row.recordingfile) {
      calls[row.callid].recordingFile = row.recordingfile;
    }
    
    switch (row.event) {
      case 'ENTERQUEUE':
        calls[row.callid].clientNumber = row.data2;
        calls[row.callid].queuePosition = row.data3;
        calls[row.callid].startTime = row.time;
        break;
      case 'CONNECT':
        calls[row.callid].connectTime = row.time;
        calls[row.callid].agent = row.data1;
        break;
      case 'COMPLETECALLER':
      case 'COMPLETEAGENT':
        calls[row.callid].endTime = row.time;
        calls[row.callid].status = row.event === 'COMPLETECALLER' 
          ? 'completed_by_caller' 
          : 'completed_by_agent';
        calls[row.callid].duration = row.data2;
        break;
      case 'ABANDON':
        calls[row.callid].endTime = row.time;
        calls[row.callid].waitTime = row.data3;
        calls[row.callid].status = 'abandoned';
        break;
    }
  });

  return Object.values(calls);
}

const QUEUE_NAME = '1049';
const START_TIME = '2025-12-01 00:00:00';
const END_TIME = '2025-12-01 23:59:59';

async function testAll() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('🚀 ТЕСТ ОПТИМИЗИРОВАННЫХ ЗАПРОСОВ');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Очередь: ${QUEUE_NAME}`);
  console.log(`Период: ${START_TIME} - ${END_TIME}\n`);
  
  const results = [];
  
  // Тест 1: Оригинальный запрос
  console.log('1️⃣ Тестирование оригинального запроса (JOIN)...');
  const start1 = Date.now();
  const calls1 = await getQueueCalls(pool, QUEUE_NAME, START_TIME, END_TIME);
  const time1 = Date.now() - start1;
  console.log(`   ⏱️  Время: ${time1}ms, Звонков: ${calls1.length}\n`);
  results.push({ name: 'Оригинальный (JOIN)', time: time1, calls: calls1.length });
  
  // Тест 2: UltraFast запрос
  console.log('2️⃣ Тестирование UltraFast запроса (2 запроса + Map)...');
  const start2 = Date.now();
  const calls2 = await getQueueCallsUltraFast(QUEUE_NAME, START_TIME, END_TIME);
  const time2 = Date.now() - start2;
  console.log(`   ⏱️  Время: ${time2}ms, Звонков: ${calls2.length}\n`);
  results.push({ name: 'UltraFast (2 запроса)', time: time2, calls: calls2.length });
  
  // Тест 3: Subquery запрос
  console.log('3️⃣ Тестирование Subquery запроса (подзапрос)...');
  const start3 = Date.now();
  const calls3 = await getQueueCallsSubquery(QUEUE_NAME, START_TIME, END_TIME);
  const time3 = Date.now() - start3;
  console.log(`   ⏱️  Время: ${time3}ms, Звонков: ${calls3.length}\n`);
  results.push({ name: 'Subquery', time: time3, calls: calls3.length });
  
  // Тест 4: Параллельный запрос
  console.log('4️⃣ Тестирование параллельного запроса...');
  const start4 = Date.now();
  const calls4 = await getQueueCallsParallel(QUEUE_NAME, START_TIME, END_TIME);
  const time4 = Date.now() - start4;
  console.log(`   ⏱️  Время: ${time4}ms, Звонков: ${calls4.length}\n`);
  results.push({ name: 'Параллельный', time: time4, calls: calls4.length });
  
  // Проверка совпадения результатов
  const allMatch = calls1.length === calls2.length && 
                   calls2.length === calls3.length && 
                   calls3.length === calls4.length;
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 РЕЗУЛЬТАТЫ');
  console.log('═══════════════════════════════════════════════════════');
  console.log('Метод                    | Время     | Звонков | Улучшение');
  console.log('─────────────────────────┼───────────┼─────────┼──────────');
  
  results.sort((a, b) => a.time - b.time);
  const fastest = results[0].time;
  
  results.forEach(r => {
    const improvement = ((r.time - fastest) / fastest * 100).toFixed(1);
    const improvementStr = r.time === fastest 
      ? '🏆 Лучший' 
      : `${improvement}% медленнее`;
    console.log(`${r.name.padEnd(24)} | ${String(r.time).padStart(7)}ms | ${String(r.calls).padStart(7)} | ${improvementStr}`);
  });
  
  console.log(`\n✅ Результаты ${allMatch ? 'совпадают' : 'НЕ совпадают'}`);
  console.log(`🏆 Победитель: ${results[0].name} - ${results[0].time}ms`);
  console.log(`⚡ Ускорение: ${((time1 - results[0].time) / time1 * 100).toFixed(1)}% быстрее оригинала\n`);
  
  process.exit(0);
}

testAll().catch(error => {
  console.error('❌ Ошибка:', error);
  process.exit(1);
});

