import { conclusionReviewPrompt, hostPrompt, speakerPrompt } from './rooms/chat/prompts.js'
import { alignmentPrompt } from './rooms/create/prompts.js'
import { studioWorkerPrompt } from './rooms/studio/prompts.js'
import { STAGE_STATUS } from '../../shared/states.js'

// 提示词是行为的一部分：模型看到什么，房间就怎么工作。
// 这里把关键提示词固定成可对照的样本；改提示词时 git diff 就是行为变化。
const chatRoom = {
  id: 'room-chat',
  name: '圆桌',
  goal: '把发布检查做出来',
  members: [
    { id: 'a', name: '甲', personality: 'proposer' },
    { id: 'b', name: '乙', personality: 'critic' },
  ],
}

const studioRoom = {
  id: 'room-studio',
  name: '发布',
  goal: '把发布检查做出来',
  plan: { done: ['有发布检查清单'] },
  stages: [{ title: '写清单', state: STAGE_STATUS.active }],
}

export const promptSamples = () => [
  {
    name: 'chat-host-natural',
    text: hostPrompt({ room: chatRoom, round: 2, note: '', turnLimit: 6 }),
  },
  {
    name: 'chat-host-structured',
    text: hostPrompt({ room: chatRoom, round: 2, note: '列成清单', turnLimit: 6, structured: true }),
  },
  {
    name: 'chat-speaker-first',
    text: speakerPrompt({ room: chatRoom, memberId: 'a', round: 2, turn: 1, turnLimit: 6, note: '' }),
  },
  {
    name: 'chat-speaker-follow',
    text: speakerPrompt({
      room: chatRoom,
      memberId: 'b',
      round: 2,
      turn: 2,
      turnLimit: 6,
      note: '别写太长',
      brief: '先做最小版本',
      previous: { name: '甲', text: '先把检查写出来。' },
    }),
  },
  {
    name: 'chat-conclusion-review',
    text: conclusionReviewPrompt({
      room: chatRoom,
      reviewer: { name: '乙' },
      conclusion: '共识：先做最小版本；未定：下周上线。',
      transcript: '甲：先做最小版本。\n乙：上线时间还没定。',
    }),
  },
  {
    name: 'studio-alignment',
    text: alignmentPrompt('把发布检查做出来', 'test', 'npm test', null, [
      { id: 'claude', available: true, models: { default: 'claude-sonnet-5' } },
      { id: 'pi', available: true, models: { default: 'pi-3' } },
    ]),
  },
  {
    name: 'studio-worker-package',
    text: studioWorkerPrompt({
      room: studioRoom,
      messages: [],
      memberId: 'executor-1',
      stage: { title: '写清单' },
      workPackage: { title: '发布清单', files: ['RELEASE.md'], check: 'test -f RELEASE.md' },
      index: 0,
      acceptance: 'test -f RELEASE.md',
      workspace: {},
      port: 3001,
      environment: { linked: ['node_modules'] },
    }),
  },
]
