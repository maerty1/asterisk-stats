/**
 * Главный файл роутов - экспортирует все роутеры
 */

const settingsRouter = require('./settings');
const emailReportsRouter = require('./email-reports');
const rankingsRouter = require('./rankings');
const healthRouter = require('./health');
const comparisonRouter = require('./comparison');
const viewsModule = require('./views');

module.exports = {
  settingsRouter,
  emailReportsRouter,
  rankingsRouter,
  healthRouter,
  comparisonRouter,
  viewsRouter: viewsModule.router,
  initViewsRouter: viewsModule.init
};
