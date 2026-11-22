// 依赖图门禁：只锁已确认的边界，不做通用架构警察。
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: '循环依赖先拆成单向；不要用动态 import 绕开。',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-unresolved',
      severity: 'error',
      comment: '相对导入必须能解析；解析不了说明路径或扩展名错了。',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'ui-not-to-server',
      severity: 'error',
      comment: '界面只通过 HTTP/共享契约读服务端，不直接 import server。',
      from: { path: '^ui/src/', pathNot: '\\.test\\.js$' },
      to: { path: '^server/' },
    },
    {
      name: 'server-not-to-ui',
      severity: 'error',
      comment: '服务端不 import 界面代码。',
      from: { path: '^server/', pathNot: '\\.test\\.js$' },
      to: { path: '^ui/' },
    },
    {
      name: 'shared-not-to-app',
      severity: 'error',
      comment: '共享契约只向内依赖，不 import server 或 ui；测试可以跨层做集成。',
      from: { path: '^shared/', pathNot: '\\.test\\.js$' },
      to: { path: '^(server|ui)/' },
    },
    {
      name: 'kernel-not-to-room-engines',
      severity: 'error',
      comment: '内核只通过 rooms/kinds.js 或 facade 找房型，不直接 import 具体引擎。',
      from: { path: '^server/crew/kernel/', pathNot: '\\.test\\.js$' },
      to: { path: '^server/crew/rooms/(chat|studio)/' },
    },
    {
      name: 'chat-not-to-studio',
      severity: 'error',
      comment: '聊天室和工作室是两套引擎，不互相 import。',
      from: { path: '^server/crew/rooms/chat/', pathNot: '\\.test\\.js$' },
      to: { path: '^server/crew/rooms/studio/' },
    },
    {
      name: 'studio-not-to-chat',
      severity: 'error',
      comment: '聊天室和工作室是两套引擎，不互相 import。',
      from: { path: '^server/crew/rooms/studio/', pathNot: '\\.test\\.js$' },
      to: { path: '^server/crew/rooms/chat/' },
    },
    {
      name: 'crew-core-not-to-adapters',
      severity: 'error',
      comment: '应用层依赖端口，不直接 import 存储、引擎、基座或具体工作区。',
      from: { path: '^server/crew/(rooms|kernel|service|service-queries)/', pathNot: '\\.test\\.js$' },
      to: { path: '^server/crew/(store|engine|base|crew-ports|paths|room-repo|member-env|workspace-git|workspace-direct|workspace-plain)\\.js$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '^(node_modules|ui/dist|release|build|third_party|test-results|evals/.*/results|vite\\.config\\.js)',
    },
  },
}
