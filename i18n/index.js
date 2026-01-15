/**
 * Модуль интернационализации (i18n)
 * Поддержка русского и английского языков
 */

const translations = {
  ru: require('./ru.json'),
  en: require('./en.json')
};

const DEFAULT_LOCALE = 'ru';
const SUPPORTED_LOCALES = ['ru', 'en'];

/**
 * Получить перевод по ключу
 * @param {string} key - Ключ перевода (например, 'nav.analytics')
 * @param {string} locale - Язык
 * @param {Object} params - Параметры для подстановки
 * @returns {string} - Переведенная строка
 */
function t(key, locale = DEFAULT_LOCALE, params = {}) {
  const lang = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const keys = key.split('.');
  
  let value = translations[lang];
  
  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      // Fallback to default locale
      value = translations[DEFAULT_LOCALE];
      for (const k2 of keys) {
        if (value && typeof value === 'object' && k2 in value) {
          value = value[k2];
        } else {
          return key; // Return key if not found
        }
      }
      break;
    }
  }
  
  if (typeof value !== 'string') {
    return key;
  }
  
  // Replace parameters {{param}}
  return value.replace(/\{\{(\w+)\}\}/g, (match, param) => {
    return params[param] !== undefined ? params[param] : match;
  });
}

/**
 * Получить все переводы для языка
 * @param {string} locale - Язык
 * @returns {Object} - Объект переводов
 */
function getTranslations(locale = DEFAULT_LOCALE) {
  const lang = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  return translations[lang];
}

/**
 * Middleware для определения языка из запроса
 */
function i18nMiddleware(req, res, next) {
  // Определяем язык: query > cookie > header > default
  const locale = 
    req.query.lang ||
    req.cookies?.lang ||
    parseAcceptLanguage(req.headers['accept-language']) ||
    DEFAULT_LOCALE;
  
  req.locale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  
  // Добавляем функцию перевода в res.locals для EJS
  res.locals.t = (key, params) => t(key, req.locale, params);
  res.locals.locale = req.locale;
  res.locals.locales = SUPPORTED_LOCALES;
  
  next();
}

/**
 * Парсить Accept-Language header
 */
function parseAcceptLanguage(header) {
  if (!header) return null;
  
  const languages = header.split(',').map(lang => {
    const [code, q = 'q=1'] = lang.trim().split(';');
    return {
      code: code.split('-')[0].toLowerCase(),
      q: parseFloat(q.split('=')[1]) || 1
    };
  });
  
  languages.sort((a, b) => b.q - a.q);
  
  for (const lang of languages) {
    if (SUPPORTED_LOCALES.includes(lang.code)) {
      return lang.code;
    }
  }
  
  return null;
}

/**
 * Express роутер для смены языка
 */
const express = require('express');
const router = express.Router();

router.get('/set/:locale', (req, res) => {
  const { locale } = req.params;
  
  if (SUPPORTED_LOCALES.includes(locale)) {
    res.cookie('lang', locale, { 
      maxAge: 365 * 24 * 60 * 60 * 1000, // 1 год
      httpOnly: false 
    });
    res.json({ success: true, locale });
  } else {
    res.status(400).json({ 
      success: false, 
      error: 'Unsupported locale',
      supported: SUPPORTED_LOCALES 
    });
  }
});

router.get('/current', (req, res) => {
  res.json({
    locale: req.locale,
    supported: SUPPORTED_LOCALES,
    translations: getTranslations(req.locale)
  });
});

module.exports = {
  t,
  getTranslations,
  i18nMiddleware,
  i18nRouter: router,
  SUPPORTED_LOCALES,
  DEFAULT_LOCALE
};
