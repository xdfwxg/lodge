// 测试入口的唯一清单：npm test 用它收集文件，验收门禁用它判断矩阵链接是否会被跑到。
export const NODE_TEST_GLOBS = [
  'server/*.test.js',
  'shared/**/*.test.js',
  'scripts/*.test.mjs',
  'server/crew/**/*.test.js',
  'evals/rooms/*.test.js',
  'ui/src/**/*.test.js',
  'electron/**/*.test.js',
]

export const NODE_TEST_PATTERNS = [
  /^server\/[^/]+\.test\.js$/,
  /^shared\/(?:.+\/)?[^/]+\.test\.js$/,
  /^scripts\/[^/]+\.test\.mjs$/,
  /^server\/crew\/(?:.+\/)?[^/]+\.test\.js$/,
  /^evals\/rooms\/[^/]+\.test\.js$/,
  /^ui\/src\/(?:.+\/)?[^/]+\.test\.js$/,
  /^electron\/(?:.+\/)?[^/]+\.test\.js$/,
]

export const E2E_SPEC_PATTERN = /^e2e\/[^/]+\.spec\.mjs$/
