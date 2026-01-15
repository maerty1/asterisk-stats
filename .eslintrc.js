/**
 * ESLint Configuration (v8)
 */

module.exports = {
  env: {
    node: true,
    es2021: true,
    commonjs: true
  },
  extends: [
    'eslint:recommended',
    'prettier'
  ],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'script'
  },
  ignorePatterns: [
    'node_modules/',
    'public/js/',
    'coverage/',
    'dist/'
  ],
  rules: {
    // Ошибки
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-undef': 'error',
    'no-console': 'off',
    
    // Стиль
    'semi': ['error', 'always'],
    'quotes': ['warn', 'single', { allowTemplateLiterals: true }],
    'indent': ['warn', 2, { SwitchCase: 1 }],
    'comma-dangle': ['warn', 'never'],
    
    // Best practices
    'eqeqeq': ['warn', 'always'],
    'no-var': 'error',
    'prefer-const': 'warn',
    'no-multiple-empty-lines': ['warn', { max: 2 }],
    
    // Async
    'no-async-promise-executor': 'error',
    'require-await': 'off'
  }
};
