import { handoffGoalText } from '../../../../shared/handoff.js'

const handoffSection = handoff => {
  const text = handoffGoalText(handoff)
  return text === '' ? '' : `\n交接单：\n${text}`
}

export const alignmentPrompt = (goal, verify, acceptance, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '如果目标里有一个只有用户能拍板、且会改变结果的分叉，先调用 lodge_gate_ask_decision 提交决策卡（2–3 条路 + 推荐）；这一回合不要写计划、不要派活、不要 @ 任何人。没有这种分叉再往下说计划。',
  '用一两句人话说清：下一步做什么、交给谁；算过的标准一句带过。不要标题、分点、标签或步骤编号。',
  '不要说“目标清晰 / 没有分叉 / 不用拍板”这类判断，也不要写“做完后你能看到什么”；这些不增加信息。',
  '最后一行单独写 @ 下一位 加一句动作；正文里不要出现 @。不要复述目标原文，不要写口径、阶段或待确认；不要问用户，也不要 @ 用户。',
  '这一回合只写计划；系统会把计划交给执行官。',
].join('\n')

export const directPrompt = (goal, verify, acceptance, singleMember, handoff = null) => [
  `目标：${goal}${handoffSection(handoff)}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '口径可能影响结果时，先用一句话把你采用的口径写死；不要停下来问用户，也不要 @ 用户。',
  singleMember
    ? '这是单人房间：直接在当前工作区完成，不要等人对齐。'
    : '这个房间没有单独的规划师：直接在当前工作区完成，不要等人对齐。',
].join('\n')
