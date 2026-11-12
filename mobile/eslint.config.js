const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    rules: {
      // New with the React 19 rule set. They flag patterns this app uses in many places and
      // which work (loading a form from fetched data, reading a ref while rendering).
      // Kept visible as warnings rather than rewritten.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
  { ignores: ['.expo/**', 'dist/**', 'node_modules/**'] },
]);
