import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** ESLint 9 flat config for the API: the standard JavaScript and TypeScript rule sets. */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    rules: {
      // `any` is used on purpose at the edges (request bodies, raw query rows, test doubles).
      '@typescript-eslint/no-explicit-any': 'off',
      // require() is used on purpose to load a module late (optional packages, isolated test copies).
      '@typescript-eslint/no-require-imports': 'off',
      // Unused things are reported, except those marked with a leading underscore.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
);
