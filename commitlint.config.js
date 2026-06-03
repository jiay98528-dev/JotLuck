export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        'editor',
        'renderer',
        'search',
        'export',
        'share',
        'sidebar',
        'tauri',
        'ui',
        'types',
        'config',
        'docs',
        'deps',
      ],
    ],
  },
};
