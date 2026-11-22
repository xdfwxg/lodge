import { handoffGoalText } from '../../../../shared/handoff.js'

const handoffSection = handoff => {
  const text = handoffGoalText(handoff)
  return text === '' ? '' : `\n交接单：\n${text}`
}

export const alignmentPrompt = (goal, verify, acceptance, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '口径可能影响结果时，先用一句话把你采用的口径写死；不要停下来问用户，也不要 @ 用户。需要人拍板的分叉留给决策阶段。',
  '对齐回合结束后系统会自动确认并继续；收到「阶段已确认」后只派当前阶段。',
].join('\n')

export const directPrompt = (goal, verify, acceptance, singleMember, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '口径可能影响结果时，先用一句话把你采用的口径写死；不要停下来问用户，也不要 @ 用户。',
  singleMember
    ? '这是单人房间：直接在当前工作区完成，不要等人对齐。'
    : '这个房间没有单独的队长：直接在当前工作区完成，不要等人对齐。',
].join('\n')
