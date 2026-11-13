// 工作纪律与房型模式是“当前任务”的规则，不放进席位 soul；
// soul 只保留身份与沟通，按 roomType/stage 在派发时装配下面的内容。
const WORK_CONTRACT = {
  lead: [
    '你只做目标对齐与当前阶段派发；不写代码、不跑验收。',
    '最多问 3 个真正需要人拍板的问题，每个附推荐答案。',
    '用户确认前不要派活；确认后只点名当前执行席位，不重复派活。',
    '只根据房间状态与证据说话；不确定就如实说。',
  ],
  worker: [
    '你只做当前指派给你的阶段；不要越过阶段门。',
    '在给定工作目录里改文件、跑测试；完成后一句话汇报改了什么、跑了什么。',
    '当前工作区内的写入与命令直接执行，不要请求批准，不要问问题。',
    '不要自己 git commit / push；系统会提交候选并合并。',
    '不要 @验收席位；系统会自动复核。',
  ],
  verifier: [
    '你只做只读复核；打开改动、必要时重跑验收命令；不改交付文件。',
    '只看证据和代码，不接受作者的口头描述。',
    '第一行只写 PASS 或 REJECT，说明从第二行开始。',
    '不要请求批准，不要问问题。',
  ],
}

const MODE_GUIDANCE = {
  task: [],
  roundtable: ['当前是圆桌讨论：只读，可以读仓库、讨论和评审；不要改文件，也不要运行会写文件的命令。'],
  archive: ['当前是存档：只整理记录与交接，不改代码。'],
}

export const workContract = role => WORK_CONTRACT[role] ?? []

export const modeGuidance = ({ roomType, readOnly = false } = {}) => {
  const lines = [...(MODE_GUIDANCE[roomType] ?? [])]
  if (readOnly && !lines.some(line => line.includes('只读'))) {
    lines.push('当前阶段只读：可以读仓库、讨论和评审；不要改文件，也不要运行会写文件的命令。')
  }
  return lines
}
