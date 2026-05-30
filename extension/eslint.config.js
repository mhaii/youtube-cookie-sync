'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const eslintConfigPrettier = require('eslint-config-prettier');

module.exports = [
  {
    ignores: ['eslint.config.js', 'node_modules/**'],
  },
  {
    ...js.configs.recommended,
    files: ['**/*.js'],
  },
  {
    ...eslintConfigPrettier,
    files: ['**/*.js'],
  },
  {
    files: ['**/*.js'],
    ignores: ['**/__tests__/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.es2020,
        browser: 'readonly',
        chrome: 'readonly',
        module: 'readonly',
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
  {
    files: ['**/__tests__/**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      strict: 'off',
    },
  },
];
