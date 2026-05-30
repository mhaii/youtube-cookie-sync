'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier');

const extensionFiles = ['**/*.js'];

module.exports = [
  {
    ...js.configs.recommended,
    files: extensionFiles,
  },
  {
    ...eslintConfigPrettier,
    files: extensionFiles,
  },
  {
    files: extensionFiles,
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2020,
        browser: 'readonly',
        chrome: 'readonly',
      },
    },
    rules: {
      strict: ['error', 'global'],
      'no-unused-vars': ['error', { vars: 'local' }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: ['error', 'multi-line'],
      'no-var': 'error',
      'no-func-assign': 'off',
      'no-inner-declarations': 'off',
    },
  },
];
