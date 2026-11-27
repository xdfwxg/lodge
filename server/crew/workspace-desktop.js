import { mkdirSync } from 'node:fs'
import * as plain from './workspace-plain.js'

// 电脑是一种工作区：文件和普通目录一样落在副本里，多出来的是这间房可以伸手到桌面。
// 提供方是外部的 MCP 服务器，不是我们写的执行引擎。
export * from './workspace-plain.js'

export const id = 'desktop'

export const capabilities = () => ({
  ...plain.capabilities(),
  // 一台电脑只有一个桌面：不做并行工作包的合并，执行官只有一位。
  merge: false,
  desktop: true,
})

// 没选文件夹时建房会给一个空目录；桌面工作区也用它放交付物和截图。
export const prepareRoom = input => {
  try {
    mkdirSync(input.source, { recursive: true })
  } catch {}
  return plain.prepareRoom(input)
}
