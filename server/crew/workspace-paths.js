import { existsSync, realpathSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const canonical = path => {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

// 清理只动工作区根目录里的东西；房间记录坏了也不能把删除带到外面。
export const isWithin = (root, target) => {
  if (typeof root !== 'string' || root === '' || typeof target !== 'string' || target === '') return false
  const inside = (base, path) => path === base || path.startsWith(`${base}${sep}`)
  if (existsSync(target)) return inside(canonical(root), realpathSync(target))
  return inside(resolve(root), resolve(target))
}
