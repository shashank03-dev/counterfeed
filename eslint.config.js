import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/release/**', 'apps/desktop/e2e/artifacts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    files: ['**/*.mjs', 'apps/desktop/e2e/**'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly', window: 'readonly', document: 'readonly', performance: 'readonly', requestAnimationFrame: 'readonly', PerformanceObserver: 'readonly', setTimeout: 'readonly', localStorage: 'readonly', navigator: 'readonly', getComputedStyle: 'readonly', HTMLInputElement: 'readonly', Event: 'readonly' } },
  },
);
