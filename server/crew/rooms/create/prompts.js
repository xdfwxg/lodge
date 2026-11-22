import { handoffGoalText } from '../../../../shared/handoff.js'

const handoffSection = handoff => {
  const text = handoffGoalText(handoff)
  return text === '' ? '' : `\n交接单：\n${text}`
}

export const alignmentPrompt = (goal, verify, acceptance, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '按 lodge-plan 的 Specify 结构，用短行回复；不要写成大段。格式固定为：',
  '**完成标准：** 一句话说清做完后用户能看到什么。',
  '**口径：** 最多 3 条，每条单独一行，以「- 」开头；只写会影响结果的选择。',
  '**阶段：** 按顺序每行一步，写清谁做、做完看什么；能并行就写在同一行。',
  '**待确认：** 只写会卡住流程的分叉；没有就省略这一节。',
  '标签用 ** 包起来，不要用行内代码包中文标签。总长不超过 12 行；不要复述目标原文，不要问用户，也不要 @ 用户。需要人拍板的分叉留给决策阶段。',
  '这一回合只写对齐，不要派活，也不要写第二段；系统会自动确认并派当前阶段。',
].join('\n')

export const directPrompt = (goal, verify, acceptance, singleMember, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '口径可能影响结果时，先用一句话把你采用的口径写死；不要停下来问用户，也不要 @ 用户。',
  singleMember
    ? '这是单人房间：直接在当前工作区完成，不要等人对齐。'
    : '这个房间没有单独的队长：直接在当前工作区完成，不要等人对齐。',
].join('\n')
