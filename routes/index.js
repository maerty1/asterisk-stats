/**
 * Главный файл роутов - экспортирует все роутеры
 */

const settingsRouter = require('./settings');
const emailReportsRouter = require('./email-reports');
const rankingsRouter = require('./rankings');
const healthRouter = require('./health');
const comparisonRouter = require('./comparison');

module.exports = {
  settingsRouter,
  emailReportsRouter,
  rankingsRouter,
  healthRouter,
  comparisonRouter
};
