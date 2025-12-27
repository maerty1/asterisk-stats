/**
 * Скрипт для сравнения производительности различных коннекторов БД
 */

require('dotenv').config();
const { format } = require('date-fns');

// Параметры теста
const TEST_DATE = '2025-12-01';
const QUEUE_NAME = '1049';
const START_TIME = `${TEST_DATE} 00:00:00`;
const END_TIME = `${TEST_DATE} 23:59:59`;

// Импортируем функции для получения данных
const { 
  getQueueCallsParallel 
} = require('./db-parallel');

const {
  getQueueCallsOptimized
} = require('./db-large-data');

// Список адаптеров для тестирования
const ADAPTERS_TO_TEST = ['mysql2', 'sequelize', 'knex', 'objection', 'bookshelf', 'typeorm'];

async function testAdapter(adapterName) {
  console.log(`\n🔍 Тестирование адаптера: ${adapterName}`);
  
  // Устанавливаем адаптер через переменную окружения
  process.env.DB_ADAPTER = adapterName;
  
  try {
    // Перезагружаем модули для применения нового адаптера
    delete require.cache[require.resolve('./db-factory')];
    delete require.cache[require.resolve('./db-optimizer')];
    delete require.cache[require.resolve('./db-parallel')];
    delete require.cache[require.resolve('./db-large-data')];
    
    const { pool, execute: dbExecute } = require('./db-optimizer');
    const { getQueueCallsParallel } = require('./db-parallel');
    
    // Функция получения звонков (как в app.js)
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
    
    // Тест 1: Простой запрос (getQueueCalls) - используем dbExecute из адаптера
    const start1 = Date.now();
    let calls1;
    try {
      // Используем dbExecute напрямую, так как адаптер уже настроен в db-optimizer
      const [rows] = await dbExecute(`
        SELECT 
          q.time, q.event, q.callid, q.queuename, q.agent, 
          q.data1, q.data2, q.data3, q.data4, q.data5,
          c.recordingfile, c.linkedid
        FROM asteriskcdrdb.queuelog q
        LEFT JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid AND c.disposition = 'ANSWERED'
        WHERE q.queuename = ? 
          AND q.time BETWEEN ? AND ?
        ORDER BY q.time
      `, [QUEUE_NAME, START_TIME, END_TIME]);

      // Обрабатываем результаты так же, как в getQueueCalls
      // Sequelize может вернуть объект вместо массива, нормализуем
      const rowsArray = Array.isArray(rows) ? rows : (rows[0] || []);
      const calls = {};
      rowsArray.forEach(row => {
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
      
      calls1 = Object.values(calls);
    } catch (error) {
      console.error(`  ❌ Ошибка при выполнении простого запроса: ${error.message}`);
      return null;
    }
    const time1 = Date.now() - start1;
    
    // Тест 2: Параллельный запрос (getQueueCallsParallel)
    const start2 = Date.now();
    let calls2;
    try {
      calls2 = await getQueueCallsParallel(QUEUE_NAME, START_TIME, END_TIME);
    } catch (error) {
      console.error(`  ❌ Ошибка при выполнении параллельного запроса: ${error.message}`);
      return {
        adapter: adapterName,
        simpleQuery: time1,
        parallelQuery: null,
        callsCount: calls1 ? calls1.length : 0,
        error: error.message
      };
    }
    const time2 = Date.now() - start2;
    
    // Проверяем, что результаты совпадают
    const resultsMatch = calls1.length === calls2.length;
    
    console.log(`  ✅ Простой запрос: ${time1}ms (${calls1.length} звонков)`);
    console.log(`  ✅ Параллельный запрос: ${time2}ms (${calls2.length} звонков)`);
    console.log(`  ${resultsMatch ? '✅' : '⚠️ '} Результаты ${resultsMatch ? 'совпадают' : 'не совпадают'}`);
    
    // Закрываем соединения
    try {
      const { resetAdapter } = require('./db-factory');
      resetAdapter();
    } catch (e) {
      // Игнорируем ошибки при закрытии
    }
    
    return {
      adapter: adapterName,
      simpleQuery: time1,
      parallelQuery: time2,
      callsCount: calls1.length,
      resultsMatch
    };
    
  } catch (error) {
    console.error(`  ❌ Критическая ошибка: ${error.message}`);
    return {
      adapter: adapterName,
      error: error.message
    };
  }
}

async function runBenchmark() {
  console.log('═══════════════════════════════════════════════════════');
  console.log('📊 БЕНЧМАРК КОННЕКТОРОВ БД');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`Дата: ${TEST_DATE}`);
  console.log(`Очередь: ${QUEUE_NAME}`);
  console.log(`Период: ${START_TIME} - ${END_TIME}`);
  console.log('═══════════════════════════════════════════════════════');
  
  const results = [];
  
  for (const adapterName of ADAPTERS_TO_TEST) {
    const result = await testAdapter(adapterName);
    if (result) {
      results.push(result);
    }
    
    // Небольшая пауза между тестами
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  // Выводим итоговую таблицу
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📈 РЕЗУЛЬТАТЫ БЕНЧМАРКА');
  console.log('═══════════════════════════════════════════════════════');
  console.log('\nАдаптер           | Простой запрос | Параллельный | Звонков | Статус');
  console.log('──────────────────┼────────────────┼──────────────┼─────────┼─────────');
  
  // Сортируем по времени параллельного запроса
  results.sort((a, b) => {
    const timeA = a.parallelQuery || a.simpleQuery || Infinity;
    const timeB = b.parallelQuery || b.simpleQuery || Infinity;
    return timeA - timeB;
  });
  
  for (const result of results) {
    if (result.error) {
      console.log(`${result.adapter.padEnd(17)} | ${'N/A'.padStart(14)} | ${'N/A'.padStart(12)} | ${'N/A'.padStart(7)} | ❌ Ошибка`);
      continue;
    }
    
    const simple = result.simpleQuery ? `${result.simpleQuery}ms` : 'N/A';
    const parallel = result.parallelQuery ? `${result.parallelQuery}ms` : 'N/A';
    const status = result.resultsMatch ? '✅ OK' : '⚠️ Различаются';
    
    console.log(`${result.adapter.padEnd(17)} | ${simple.padStart(14)} | ${parallel.padStart(12)} | ${String(result.callsCount).padStart(7)} | ${status}`);
  }
  
  // Находим победителя
  const winner = results.find(r => !r.error && r.parallelQuery);
  if (winner) {
    console.log('\n🏆 ПОБЕДИТЕЛЬ (самый быстрый):');
    console.log(`   ${winner.adapter} - ${winner.parallelQuery}ms (параллельный запрос)`);
  }
  
  console.log('\n═══════════════════════════════════════════════════════\n');
  
  // Закрываем все соединения
  process.exit(0);
}

// Запускаем бенчмарк
runBenchmark().catch(error => {
  console.error('❌ Критическая ошибка бенчмарка:', error);
  process.exit(1);
});

