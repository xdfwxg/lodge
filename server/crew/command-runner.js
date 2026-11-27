// 平台执行 agent 写的命令只走这一条：由基座在边界里跑（证明、反例）。
// 没有配置端口就拒绝，不退回本地 exec——那样边界就漏了。
let runner = null

export const setCommandRunner = fn => {
  runner = typeof fn === 'function' ? fn : null
}

export const runCommand = async ({ cwd, command }) => {
  if (typeof runner !== 'function') throw new Error('没有配置命令执行端口')
  return await runner({ cwd, command })
}
