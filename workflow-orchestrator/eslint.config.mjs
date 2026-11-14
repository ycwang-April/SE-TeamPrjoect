import gts from 'gts';

export default [
  ...gts,
  {
    ignores: [
      'dist/**',
      'renderer/dist/**',
      'node_modules/**',
      '.orchestrator/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    rules: {
      'n/no-unsupported-features/node-builtins': 'off',
      'n/no-missing-import': 'off',
      'n/no-extraneous-import': 'off',
    },
  },
];
