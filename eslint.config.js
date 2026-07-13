import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.min.js',
      'e2e/**',
      '**/target/**',
      '**/.v2r/**',
      'scripts/**',
    ],
  },

  // Base config for all TS/Vue files
  ...tseslint.configs.recommended,

  // Vue files
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // Custom rules
  {
    files: ['**/*.ts', '**/*.vue'],
    rules: {
      // JotLuck strict rules
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',

      // Vue-specific
      'vue/multi-word-component-names': 'off',

      // TypeScript
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],

      // Code quality
      'no-debugger': 'error',
      'no-alert': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Config files can use console
  {
    files: ['*.config.*', '*.d.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Prettier must be last to override formatting rules
  eslintConfigPrettier,
);
