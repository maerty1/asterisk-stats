/**
 * Swagger/OpenAPI конфигурация
 */

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Asterisk Stats API',
      version: '1.1.0',
      description: `
## Описание

REST API для аналитики звонков Asterisk PBX.

### Возможности
- 📊 Статистика по очередям
- 📞 Анализ входящих/исходящих звонков
- 🏆 Рейтинг очередей
- 📧 Управление email отчетами
- ⚙️ Настройки приложения

### Аутентификация
В текущей версии API не требует аутентификации.
      `,
      contact: {
        name: 'GitHub Repository',
        url: 'https://github.com/maerty1/asterisk-stats'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000',
        description: 'Development server'
      }
    ],
    tags: [
      { name: 'Health', description: 'Проверка состояния приложения' },
      { name: 'Reports', description: 'Генерация отчетов' },
      { name: 'Rankings', description: 'Рейтинг очередей' },
      { name: 'Settings', description: 'Управление настройками' },
      { name: 'Email', description: 'Управление email рассылкой' }
    ]
  },
  apis: [
    './routes/*.js',
    './swagger-schemas.js'
  ]
};

const specs = swaggerJsdoc(options);

/**
 * Подключить Swagger UI к Express приложению
 * @param {Express} app - Express application
 */
function setupSwagger(app) {
  // Swagger UI
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(specs, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Asterisk Stats API Docs'
  }));
  
  // OpenAPI JSON spec
  app.get('/api/docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });
}

module.exports = { setupSwagger, specs };
