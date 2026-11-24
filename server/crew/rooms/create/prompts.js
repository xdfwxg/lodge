import { handoffGoalText } from '../../../../shared/handoff.js'

const handoffSection = handoff => {
  const text = handoffGoalText(handoff)
  return text === '' ? '' : `\n交接单：\n${text}`
}

export const alignmentPrompt = (goal, verify, acceptance, handoff = null, engines = []) => [
  `目标：${goal}${handoffSection(handoff)}`,
  (() => {
    const list = (Array.isArray(engines) ? engines : [])
      .filter(item => item?.available !== false && typeof item?.models?.default === 'string' && item.models.default !== '')
      .map(item => `${item.id}/${item.models.default}`)
    return list.length === 0 ? '' : `可用模型（engine/model，只能从这里选）：${list.join('、')}`
  })(),
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：每个阶段在 submit_plan 里给一条能跑的检查；最后一步由人确认。',
  '如果目标里有一个只有用户能拍板、且会改变结果的分叉，先调用 lodge_gate_ask_decision 提交决策卡（2–3 条路 + 推荐）；这一回合不要写计划、不要派活、不要 @ 任何人。没有这种分叉再往下走。',
  '没有分叉就调用 lodge_gate_submit_plan 提交方案和队伍：阶段、工作包（标题/文件/检查）、执行官和验收员（含 engine/model）。',
  '队伍规则：验收员和执行官尽量不同厂商；如果这台机器只装了一家模型，可以用同一家，并在 why 里说明是模型自查；同一阶段的工作包文件不能重叠；有几块独立工作包就开几位执行官（最多 3）；工作区不能合并时只开一位。',
  '每个阶段的检查写成相对仓库根目录的命令（例如 test -f ABOUT.md）；不要写绝对路径，执行官在自己的工作副本里跑。',
  '先在回复里用两三句人话说清为什么这么拆、这次不做什么；不要复述目标，不要贴 JSON。',
  '这一回合只提交方案和队伍：不要 @ 任何人，不要自己派活；平台会校验、开通成员并开始第一步。',
].filter(Boolean).join('\n')

export const directPrompt = (goal, verify, acceptance, singleMember, handoff = null, engines = []) => [
  `目标：${goal}${handoffSection(handoff)}`,
  (() => {
    const list = (Array.isArray(engines) ? engines : [])
      .filter(item => item?.available !== false && typeof item?.models?.default === 'string' && item.models.default !== '')
      .map(item => `${item.id}/${item.models.default}`)
    return list.length === 0 ? '' : `可用模型（engine/model，只能从这里选）：${list.join('、')}`
  })(),
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '口径可能影响结果时，先用一句话把你采用的口径写死；不要停下来问用户，也不要 @ 用户。',
  singleMember
    ? '这是单人房间：直接在当前工作区完成，不要等人对齐。'
    : '这个房间没有单独的规划师：直接在当前工作区完成，不要等人对齐。',
].join('\n')
