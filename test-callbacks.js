/**
 * Скрипт для ручной проверки логики перезвонов
 * Использование: node test-callbacks.js <queue_name> <start_date> <end_date>
 * Пример: node test-callbacks.js 8003 2025-12-01 2025-12-24
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { format } = require('date-fns');

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'freepbxuser',
  password: process.env.DB_PASS || process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'asterisk'
};

async function testCallbacks() {
  const queueName = process.argv[2] || '8003';
  const startDate = process.argv[3] || '2025-12-01';
  const endDate = process.argv[4] || '2025-12-24';
  
  const startTime = `${startDate} 00:00:00`;
  const endTime = `${endDate} 23:59:59`;
  
  console.log('=== Тест логики перезвонов ===');
  console.log(`Очередь: ${queueName}`);
  console.log(`Период: ${startTime} - ${endTime}`);
  console.log('');

  let connection;
  try {
    connection = await mysql.createConnection(DB_CONFIG);
    console.log('✅ Подключение к БД успешно\n');

    // 1. Получаем пропущенные звонки из очереди
    console.log('1. Получаем пропущенные звонки из очереди...');
    const [queueRows] = await connection.execute(`
      SELECT 
        q.time, q.event, q.callid, q.queuename, q.agent, 
        q.data1, q.data2, q.data3, q.data4, q.data5,
        c.recordingfile, c.linkedid
      FROM asteriskcdrdb.queuelog q
      LEFT JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid AND c.disposition = 'ANSWERED'
      WHERE q.queuename = ? 
        AND q.time BETWEEN ? AND ?
        AND q.event = 'ABANDON'
      ORDER BY q.time
      LIMIT 10
    `, [queueName, startTime, endTime]);

    console.log(`Найдено пропущенных звонков: ${queueRows.length}`);
    if (queueRows.length === 0) {
      console.log('❌ Пропущенных звонков не найдено');
      await connection.end();
      return;
    }

    // Берем первый пропущенный звонок для теста
    const abandonedCall = queueRows[0];
    console.log('\n2. Тестируем первый пропущенный звонок:');
    console.log(`   CallID: ${abandonedCall.callid}`);
    console.log(`   Время: ${abandonedCall.time}`);
    console.log(`   Номер клиента (data2): ${abandonedCall.data2}`);
    console.log(`   Очередь: ${abandonedCall.queuename}`);

    const clientNumber = abandonedCall.data2;
    if (!clientNumber) {
      console.log('❌ Номер клиента не найден в data2');
      await connection.end();
      return;
    }

    // Временной интервал поиска (2 часа после пропущенного звонка)
    const callbackHours = 2;
    const callStartTime = new Date(abandonedCall.time);
    const callbackStartTime = new Date(callStartTime.getTime() + 1000); // +1 секунда
    const callbackEndTime = new Date(callStartTime.getTime() + callbackHours * 3600 * 1000);
    
    const callbackStartStr = format(callbackStartTime, 'yyyy-MM-dd HH:mm:ss');
    const callbackEndStr = format(callbackEndTime, 'yyyy-MM-dd HH:mm:ss');
    
    console.log(`\n3. Период поиска перезвонов: ${callbackStartStr} - ${callbackEndStr}`);

    // Нормализуем номер
    const clientNumberStr = clientNumber.toString().trim();
    const clientNumberLast10 = clientNumberStr.slice(-10);
    const clientNumberLast9 = clientNumberStr.slice(-9);
    
    console.log(`   Номер: ${clientNumberStr}`);
    console.log(`   Последние 10 цифр: ${clientNumberLast10}`);
    console.log(`   Последние 9 цифр: ${clientNumberLast9}`);

    // Проверка 1: Перезвонил сам - ищем в той же очереди
    console.log('\n4. Проверка 1: Перезвонил сам (в той же очереди)...');
    const [queueCallbackRows] = await connection.execute(`
      SELECT 
        q.time, q.event, q.callid, q.queuename, q.data2,
        c.calldate, c.uniqueid, c.billsec, c.disposition,
        c.recordingfile, c.src, c.dst
      FROM asteriskcdrdb.queuelog q
      INNER JOIN asteriskcdrdb.cdr c ON q.callid = c.linkedid
      WHERE q.queuename = ?
        AND q.time >= ? 
        AND q.time <= ?
        AND q.event IN ('COMPLETECALLER', 'COMPLETEAGENT')
        AND c.disposition = 'ANSWERED'
        AND c.billsec >= 5
        AND (
          q.data2 LIKE ? OR q.data2 LIKE ? OR 
          RIGHT(q.data2, 10) = ? OR RIGHT(q.data2, 9) = ? OR
          q.data2 = ?
        )
      ORDER BY q.time ASC
      LIMIT 5
    `, [queueName, callbackStartStr, callbackEndStr, `%${clientNumberLast10}`, `%${clientNumberLast9}`, clientNumberLast10, clientNumberLast9, clientNumberStr]);

    console.log(`   Найдено звонков в очереди: ${queueCallbackRows.length}`);
    if (queueCallbackRows.length > 0) {
      console.log('   ✅ ПЕРЕЗВОН НАЙДЕН В ОЧЕРЕДИ:');
      queueCallbackRows.forEach((row, i) => {
        console.log(`   ${i+1}. CallID: ${row.callid}, Время: ${row.time}, Длительность: ${row.billsec} сек`);
      });
    } else {
      console.log('   ❌ Перезвон в очереди не найден');
    }

    // Проверка 2: Перезвонил сам - ищем во всей базе CDR (не только в очереди)
    console.log('\n5. Проверка 2: Перезвонил сам (во всей базе CDR)...');
    const [cdrCallbackRows] = await connection.execute(`
      SELECT 
        c.calldate, c.uniqueid, c.billsec, c.disposition,
        c.recordingfile, c.src, c.dst, c.dcontext
      FROM asteriskcdrdb.cdr c
      WHERE c.calldate >= ? 
        AND c.calldate <= ?
        AND c.disposition = 'ANSWERED'
        AND c.billsec >= 5
        AND (
          c.src LIKE ? OR c.src LIKE ? OR 
          RIGHT(c.src, 10) = ? OR RIGHT(c.src, 9) = ? OR
          c.src = ?
        )
      ORDER BY c.calldate ASC
      LIMIT 5
    `, [callbackStartStr, callbackEndStr, `%${clientNumberLast10}`, `%${clientNumberLast9}`, clientNumberLast10, clientNumberLast9, clientNumberStr]);

    console.log(`   Найдено звонков в CDR: ${cdrCallbackRows.length}`);
    if (cdrCallbackRows.length > 0) {
      console.log('   ✅ ПЕРЕЗВОН НАЙДЕН В CDR:');
      cdrCallbackRows.forEach((row, i) => {
        console.log(`   ${i+1}. UniqueID: ${row.uniqueid}, Время: ${row.calldate}, Номер: ${row.src}, Длительность: ${row.billsec} сек`);
      });
    } else {
      console.log('   ❌ Перезвон в CDR не найден');
    }

    // Проверка 3: Перезвонили мы (исходящие звонки)
    console.log('\n6. Проверка 3: Перезвонили мы (исходящие звонки)...');
    const [outboundRows] = await connection.execute(`
      SELECT 
        c.calldate, c.uniqueid, c.billsec, c.disposition,
        c.recordingfile, c.src, c.dst, c.dcontext
      FROM asteriskcdrdb.cdr c
      WHERE c.calldate >= ? 
        AND c.calldate <= ?
        AND c.disposition = 'ANSWERED'
        AND c.billsec >= 5
        AND (
          c.dst LIKE ? OR c.dst LIKE ? OR 
          RIGHT(c.dst, 10) = ? OR RIGHT(c.dst, 9) = ? OR
          c.dst = ?
        )
      ORDER BY c.calldate ASC
      LIMIT 5
    `, [callbackStartStr, callbackEndStr, `%${clientNumberLast10}`, `%${clientNumberLast9}`, clientNumberLast10, clientNumberLast9, clientNumberStr]);

    console.log(`   Найдено исходящих звонков: ${outboundRows.length}`);
    if (outboundRows.length > 0) {
      console.log('   ✅ ИСХОДЯЩИЙ ЗВОНОК НАЙДЕН:');
      outboundRows.forEach((row, i) => {
        console.log(`   ${i+1}. UniqueID: ${row.uniqueid}, Время: ${row.calldate}, Номер: ${row.dst}, Длительность: ${row.billsec} сек`);
      });
    } else {
      console.log('   ❌ Исходящий звонок не найден');
    }

    console.log('\n=== Тест завершен ===');

  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    console.error(error);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

testCallbacks();

