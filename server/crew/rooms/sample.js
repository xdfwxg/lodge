import { LODGE_HOST_LABEL } from '../member-labels.js'

export const SAMPLE_ROOM_ID = 'room-sample'

const member = ({ id, name, station }) => ({
  id,
  name,
  title: '讨论',
  role: 'worker',
  roleKind: 'participant',
  roleProfile: name,
  station,
  permissions: { read: true, exec: false, write: false },
  writeScope: 'none',
  toolSurface: ['read'],
  approval: 'ask',
  body: {
    kind: 'base',
    ref: `sample-${id}`,
    name,
    engine: 'demo',
    spec: { prompt: '', skills: [], mcp: [] },
  },
})

export const sampleRoomRecord = ({ now = Date.now() } = {}) => ({
  id: SAMPLE_ROOM_ID,
  kind: 'room',
  name: '示例：兰香如故中的羽仙记写的好不好，我们能超越写一篇吗',
  goal: '兰香如故中的羽仙记写的好不好，我们能超越写一篇吗',
  templateId: 'custom',
  roomType: 'chat',
  engine: 'demo',
  demo: true,
  live: false,
  state: 'complete',
  closure: null,
  completedAt: now - 3 * 60_000,
  completedCommit: null,
  leadMemberId: null,
  members: [
    member({ id: 'reader', name: '读者', station: '只读 · 从读者角度判断' }),
    member({ id: 'writer', name: '写作者', station: '只读 · 关心怎么改写' }),
    member({ id: 'editor', name: '编辑', station: '只读 · 看结构和可读性' }),
  ],
  independence: 'human',
  plan: null,
  stages: [],
  chatRoom: null,
  chatHost: {
    memberRef: 'sample-host',
    name: 'LodgeHostSample',
    displayName: LODGE_HOST_LABEL,
  },
  chat: {
    round: 1,
    phase: 'accepted',
    turnLimit: 6,
    turns: 6,
    conclusionId: null,
    running: false,
    speaker: '',
    note: '',
  },
  constraints: [
    '聊天室只读：成员只讨论，不执行工具、不改文件',
    '系统随机唤醒成员，每轮 6 次；主持人最后总结',
    '结论由你认可；不认可就继续讨论 6 次',
  ],
  workspace: {
    provider: 'demo',
    capabilities: { vcs: 'none', isolation: 'none', commit: false, diff: 'none' },
  },
  repoPath: null,
  sourceRepo: null,
  branch: null,
  worktrees: {},
  branches: {},
  ports: {},
  workspaceEnv: {},
  capabilities: {},
  parentRoomId: null,
  depth: 0,
  childRoomIds: [],
  idle: false,
  round: 0,
  noProgress: 0,
  turnQueue: [],
  heldMembers: [],
  heldMessages: {},
  busyMembers: [],
  busySince: null,
  chatUnread: false,
  approvals: [],
  openQuestion: null,
  gate: null,
  pastGoals: [],
  prunedMembers: [],
  version: 1,
})

export const seedSampleMessages = ({ store, room } = {}) => {
  const append = message => store.appendMessage(room.id, message)

  append({
    kind: 'system',
    text: '这是示例聊天室，内容都是样例。聊天室可以单独聊完；需要动手时，再把结论转成工作室任务，转过去时才会让你选工作目录。',
  })
  append({
    kind: 'chat',
    authorId: 'lodge-host',
    meta: { opening: true, round: 1 },
    text: '今天聊《兰香如故》里的《羽仙记》：它写得好不好，我们能不能写一版更好的。',
  })
  append({
    kind: 'chat',
    authorId: 'reader',
    text: '我先给判断：好在人物关系有张力，兰香囊和羽衣这两个意象也立住了；弱在羽仙最后为什么留下，主要靠旁白解释，前面少一个能看见的动作。整体是佳作，但没到“非这样写不可”。',
  })
  append({
    kind: 'chat',
    authorId: 'writer',
    text: '我同意“选择要可见”。如果只改一处，我会把“她舍不得”改成动作：收起羽衣，却把兰香囊挂在门外。这样读者自己看见她留下，不用旁白替她说。',
  })
  append({
    kind: 'chat',
    authorId: 'editor',
    text: '结构上可以再收一点。结尾如果只留“门开得更大些”，比再补一段解释更有余味。试写不用整篇重来，先写一段替代文本，再和原文对照。',
  })
  append({
    kind: 'chat',
    authorId: 'reader',
    text: '那就把结论落到一份交接单：先判断，再挑一处改写，最后去工作室写一段。写的时候记得选你的工作目录。',
  })
  append({
    kind: 'chat_conclusion',
    authorId: 'lodge-host',
    text: '先把判断说清，再只改一处。试写是段落级的对照，不是重写整篇。',
    meta: {
      round: 1,
      handoff: {
        topic: '《羽仙记》写得怎么样，能不能超越写一篇',
        consensus: [
          '是佳作，但没到非这样写不可',
          '先改一处：让羽仙的选择变成动作',
          '试写只写一段，不重写整篇',
        ],
        disagreements: ['结尾是留白，还是收得太快'],
        constraints: ['不引用原文长段', '试写是自己的版本，不是复述'],
        todos: ['如果你想把判断变成一篇文章，转成工作室任务再试写', '和原文对照一次'],
      },
    },
  })
}
