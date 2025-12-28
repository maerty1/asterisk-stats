# Формула расчета комплексного рейтинга очередей

## Общая формула

```
CompositeScore = 
  (answerRate × 0.30) +
  (slaRate × 0.25) +
  (normalizedVolume × 0.15) +
  ((100 - abandonRate) × (-0.20)) +
  (callbackRate × 0.10)
```

**Результат:** значение от 0 до 100 (ограничено функцией `Math.max(0, Math.min(100, score))`)

---

## Компоненты формулы

### 1. Процент ответа (Answer Rate) — вес: 30%
```
answerRate = (answeredCalls / totalCalls) × 100
```
**Где:**
- `answeredCalls` — количество отвеченных звонков
- `totalCalls` — общее количество звонков

**Вклад в рейтинг:** `answerRate × 0.30`

---

### 2. SLA Rate (Service Level Agreement) — вес: 25%
```
slaRate = (slaCalls / totalCalls) × 100
```
**Где:**
- `slaCalls` — количество звонков, принятых в первые 20 секунд
- `totalCalls` — общее количество звонков

**Вклад в рейтинг:** `slaRate × 0.25`

---

### 3. Нормализованный объем (Volume) — вес: 15%
```
normalizedVolume = min(totalCalls / 1000, 1) × 100
```
**Где:**
- `totalCalls` — общее количество звонков
- Максимальное значение нормализуется до 1000 звонков

**Вклад в рейтинг:** `normalizedVolume × 0.15`

**Пример:**
- Если `totalCalls = 500`, то `normalizedVolume = (500/1000) × 100 = 50`
- Если `totalCalls = 1500`, то `normalizedVolume = min(1500/1000, 1) × 100 = 100`

---

### 4. Процент пропущенных (Abandon Rate) — вес: -20% (отрицательный)
```
abandonRate = (abandonedCalls / totalCalls) × 100
```
**Где:**
- `abandonedCalls` — количество пропущенных звонков
- `totalCalls` — общее количество звонков

**Вклад в рейтинг:** `(100 - abandonRate) × (-0.20)`

**Примечание:** Используется отрицательный вес, так как меньше пропущенных звонков = лучше. Формула инвертирует значение через `(100 - abandonRate)`.

**Пример:**
- Если `abandonRate = 20%`, то вклад = `(100 - 20) × (-0.20) = 80 × (-0.20) = -16`
- Если `abandonRate = 10%`, то вклад = `(100 - 10) × (-0.20) = 90 × (-0.20) = -18` (лучше, но вклад более отрицательный)

---

### 5. Процент перезвонов (Callback Rate) — вес: 10%
```
callbackRate = (abandonedCalls > 0) 
  ? ((clientCallbacks + agentCallbacks) / abandonedCalls) × 100
  : 100
```
**Где:**
- `clientCallbacks` — количество перезвонов от клиентов (перезвонил сам)
- `agentCallbacks` — количество перезвонов от агентов (перезвонили мы)
- `abandonedCalls` — количество пропущенных звонков

**Вклад в рейтинг:** `callbackRate × 0.10`

**Примечание:** Если пропущенных звонков нет (`abandonedCalls = 0`), то `callbackRate = 100%`.

---

## Пример расчета

**Исходные данные:**
- `totalCalls = 1000`
- `answeredCalls = 850`
- `slaCalls = 600`
- `abandonedCalls = 150`
- `clientCallbacks = 30`
- `agentCallbacks = 20`

**Расчет компонентов:**

1. **answerRate** = `(850 / 1000) × 100 = 85%`
   - Вклад: `85 × 0.30 = 25.5`

2. **slaRate** = `(600 / 1000) × 100 = 60%`
   - Вклад: `60 × 0.25 = 15.0`

3. **normalizedVolume** = `min(1000 / 1000, 1) × 100 = 100`
   - Вклад: `100 × 0.15 = 15.0`

4. **abandonRate** = `(150 / 1000) × 100 = 15%`
   - Вклад: `(100 - 15) × (-0.20) = 85 × (-0.20) = -17.0`

5. **callbackRate** = `((30 + 20) / 150) × 100 = 33.33%`
   - Вклад: `33.33 × 0.10 = 3.33`

**Итоговый рейтинг:**
```
CompositeScore = 25.5 + 15.0 + 15.0 + (-17.0) + 3.33 = 41.83
```

---

## Веса компонентов (приоритеты)

| Компонент | Вес | Приоритет |
|-----------|-----|-----------|
| Процент ответа (Answer Rate) | 30% | Высокий |
| SLA Rate | 25% | Высокий |
| Нормализованный объем | 15% | Средний |
| Процент пропущенных (инвертированный) | -20% | Средний (отрицательный) |
| Процент перезвонов | 10% | Низкий |

**Итого:** `30% + 25% + 15% + (-20%) + 10% = 60%` (абсолютных весов)

**Примечание:** Отрицательный вес для `abandonRate` означает, что пропущенные звонки снижают рейтинг, а хорошая обработка пропущенных (низкий `abandonRate`) увеличивает рейтинг.

---

## Дополнительная информация

### Определение "пропущенного звонка"
Звонок считается пропущенным, если:
- `status === 'abandoned'`, или
- `duration <= 5 секунд`, или
- Нет `connectTime` и есть `endTime`, и статус не `completed_by_agent` или `completed_by_caller`

### Определение "отвеченного звонка"
Звонок считается отвеченным, если он не является пропущенным по критериям выше.

### Определение "SLA звонка"
Звонок соответствует SLA, если:
- Он отвечен (`!isAbandoned`)
- Время ожидания (`waitTime`) ≤ 20 секунд

---

## Код расчета (JavaScript)

```javascript
function calculateCompositeScore(stats) {
  if (stats.totalCalls === 0) return 0;

  const weights = {
    answerRate: 0.30,
    slaRate: 0.25,
    volume: 0.15,
    abandonRate: -0.20,
    callbackRate: 0.10
  };

  const normalizedVolume = Math.min(stats.totalCalls / 1000, 1) * 100;
  
  const callbackRate = stats.abandonedCalls > 0
    ? ((stats.clientCallbacks + stats.agentCallbacks) / stats.abandonedCalls) * 100
    : 100;

  const score = 
    (stats.answerRate * weights.answerRate) +
    (stats.slaRate * weights.slaRate) +
    (normalizedVolume * weights.volume) +
    ((100 - stats.abandonRate) * weights.abandonRate) +
    (callbackRate * weights.callbackRate);

  return Math.max(0, Math.min(100, score));
}
```

---

## Интерпретация результатов

| Диапазон рейтинга | Оценка | Интерпретация |
|-------------------|--------|---------------|
| 80-100 | Отлично | Очень высокое качество обслуживания |
| 60-79 | Хорошо | Хорошее качество обслуживания |
| 40-59 | Удовлетворительно | Среднее качество, есть что улучшить |
| 20-39 | Плохо | Низкое качество, требуются меры |
| 0-19 | Очень плохо | Критически низкое качество |

---

**Дата создания:** 2025-01-XX  
**Версия:** 1.0  
**Файл:** `/opt/asterisk-stats/queue-rankings.js` (функция `calculateCompositeScore`)

