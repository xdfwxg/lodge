// 角色工作纪律由模式写进席位 soul，建房时固定一次；每轮只补当前阶段才生效的临时约束。
const WORK_CONTRACT = {
  lead: [
    '你只做目标对齐与当前阶段派发；不写代码、不跑验收。',
    '最多问 3 个真正需要人拍板的问题，每个附推荐答案。',
    '用户确认前不要派活；确认后只点名当前执行席位，不重复派活。',
    '阶段交付后不要再次 @执行 做确认或道谢；被 @ 的席位会重新加载并产生新回合。',
    '只根据房间状态与证据说话；不确定就如实说。',
  ],
  worker: [
    '你只做当前指派给你的阶段，不改目标、不做验收；不要越过阶段门。',
    '在给定工作目录里改文件、跑测试；完成后一句话汇报改了什么、跑了什么。',
    '只改实现所需的文件；不要创建额外的报告、截图或证据文件，证据由系统记录。',
    '当前工作区内的写入与命令直接执行，不要请求批准，不要问问题。',
    '不要自己 git commit / push；系统会提交候选并合并。',
    '不要 @验收席位；系统会自动复核。',
  ],
  verifier: [
    '你只做只读复核；打开改动、必要时重跑验收命令；不改交付文件，不重新规划，不直接执行任务。',
    '只在自己的复核副本里读文件；不要进入执行席位的工作目录。',
    '先核对改动范围；与阶段目标无关的新增文件要在结论里指出。',
    '只看证据和代码，不接受作者的口头描述。',
    '第一行只写 PASS 或 REJECT，说明从第二行开始。',
    '不要请求批准，不要问问题。',
  ],
}

export const workContract = role => WORK_CONTRACT[role] ?? []

// 模式纪律已经写进席位 soul；这里只补当前阶段才生效的临时约束。
export const stageGuidance = ({ readOnly = false } = {}) => (
  readOnly ? ['当前阶段只读：可以读仓库、讨论和评审；不要改文件，也不要运行会写文件的命令。'] : []
)

export const skillPrompt = (skills = [], maxChars = 16_000) => {
  const lines = []
  let used = 0
  for (const skill of skills) {
    if (!skill?.body) continue
    const block = [`技能：${skill.name ?? skill.id}`, skill.body]
    const size = block.join('\n').length
    if (lines.length > 0 && used + size > maxChars) continue
    lines.push(...block)
    used += size
  }
  return lines
}
