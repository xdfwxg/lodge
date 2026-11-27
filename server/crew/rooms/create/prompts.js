import { handoffBriefGoalText } from '../../../../shared/handoff-brief.js'

const briefSection = handoffBrief => {
  const text = handoffBriefGoalText(handoffBrief)
  return text === '' ? '' : `\n交接简报：\n${text}`
}

// engine 和 model 要分开写：模型 id 自己可能带斜杠（deepseek/deepseek-flash），
// 写成 engine/model 的串会被拆错，规划师会把厂商名填进 engine。所以箭头分开、并说清别拆。
export const engineOptionsLine = engines => {
  const list = (Array.isArray(engines) ? engines : [])
    .filter(item => item?.available !== false && typeof item?.models?.default === 'string' && item.models.default !== '')
  if (list.length === 0) return ''
  const options = list.map(item => `${item.id} → ${item.models.default}`).join('；')
  return `可用引擎（engine）与默认模型（model）：${options}。engine 只填箭头左边那一项；model 填箭头右边整串，带斜杠也照抄，不要拆开。`
}

export const alignmentPrompt = (goal, handoffBrief = null, engines = []) => [
  `目标：${goal}${briefSection(handoffBrief)}`,
  engineOptionsLine(engines),
  '如果目标里有一个只有用户能拍板、且会改变结果的分叉，先调用 lodge_gate_ask_decision 提交决策卡（2–3 条路 + 推荐）；这一回合不要写计划、不要派活、不要 @ 任何人。没有这种分叉再往下走。',
  '你的工作目录就是这次任务的仓库副本，等同仓库根；按它工作，不要问仓库根在哪，也不要因为目录看起来空就停下来。',
  '没有分叉就调用 lodge_gate_submit_plan 提交契约、方案和队伍：契约先写清 1–6 条可观察结果（id、要求、看到什么算做到）以及边界、非目标、关键假设；每个阶段写清交付物（做完会得到什么）、clauseIds（引用契约 id，所有 outcome 都要分配到阶段）、工作包（标题/文件/负责的 clauseIds，每条阶段要求都要落到一个包）、执行官和验收员们（含 engine/model）。契约只定“做到什么算完成”，不写验收命令；done 由契约自动派生，不要再写一份。',
  '行为要变的步骤默认 behavior 是 change：交付的证明必须能在改动前的版本上失败；重构或保持行为不变的步骤写 behavior: preserve。',
  '你只负责拆解：顺序、依赖、并行、风险，以及每一步交付什么。不要写验收命令，也不要决定怎么验收；验收方法由验收员按目标自己定。',
  '队伍规则：验收员至少一位、最多三位；普通步骤一位，高风险步骤（并行工作包，或改到依赖清单、锁文件、CI/配置、.env）默认两位，而且两位要来自不同厂商，全部通过才收口；每一位验收员都要和所有执行官不同厂商；如果这台机器只装了一家模型，可以用同一家，并在 why 里说明是模型自查、不算独立复核；同一阶段的工作包文件不能重叠；有几块独立工作包就开几位执行官（最多 3）；工作区不能合并时只开一位。',
  '先在回复里用两三句人话说清为什么这么拆、这次不做什么；不要复述目标，不要贴 JSON。',
  '这一回合只提交方案和队伍：不要 @ 任何人，不要自己派活；平台会校验、开通成员并开始第一步。',
].filter(Boolean).join('\n')

export const directPrompt = (goal, singleMember, handoffBrief = null, engines = []) => [
  `目标：${goal}${briefSection(handoffBrief)}`,
  engineOptionsLine(engines),
  '口径可能影响结果时，先用一句话把你采用的口径写死；不要停下来问用户，也不要 @ 用户。',
  singleMember
    ? '这是单人房间：直接在当前工作区完成，不要等人对齐。'
    : '这个房间没有单独的规划师：直接在当前工作区完成，不要等人对齐。',
].join('\n')
