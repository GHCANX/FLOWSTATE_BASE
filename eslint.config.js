import globals from 'globals';

export default [
  {
    ignores: [
      'external/**',
      'node_modules/**',
      'temp_slp/**',
      'payloads/**',
      '*.db*',
      'test_payloads/**',
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2024,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'error',
      'no-constant-condition': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
