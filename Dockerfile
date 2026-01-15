# Asterisk Stats - Docker Image
# Multi-stage build for smaller image size

# Stage 1: Build
FROM node:16-alpine AS builder

WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости (включая devDependencies для build)
RUN npm ci

# Копируем исходный код
COPY . .

# Stage 2: Production
FROM node:16-alpine

WORKDIR /app

# Устанавливаем только production зависимости
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Копируем код из builder
COPY --from=builder /app/app.js ./
COPY --from=builder /app/logger.js ./
COPY --from=builder /app/helpers.js ./
COPY --from=builder /app/stats-calculator.js ./
COPY --from=builder /app/callback-checker.js ./
COPY --from=builder /app/settings-db.js ./
COPY --from=builder /app/queue-rankings.js ./
COPY --from=builder /app/queue-rankings-helper.js ./
COPY --from=builder /app/email-service.js ./
COPY --from=builder /app/db-*.js ./
COPY --from=builder /app/db-adapters ./db-adapters
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public

# Создаем директорию для логов
RUN mkdir -p logs

# Создаем non-root пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 -G nodejs

# Устанавливаем владельца
RUN chown -R nodejs:nodejs /app

# Переключаемся на non-root пользователя
USER nodejs

# Переменные окружения по умолчанию
ENV NODE_ENV=production \
    PORT=3000 \
    LOG_LEVEL=info

# Открываем порт
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health/live || exit 1

# Запуск приложения
CMD ["node", "app.js"]
