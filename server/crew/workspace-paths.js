import { existsSync, mkdirSync, realpathSync } from 'node:fs'
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

// 运行文件目录不能顺着仓库里的软链跑到工作区外。
export const ensureDirInside = (root, dir) => {
  if (typeof root !== 'string' || root === '' || typeof dir !== 'string' || dir === '') {
    throw new Error('缺少工作区目录')
  }
  mkdirSync(dir, { recursive: true })
  if (!isWithin(root, dir)) throw new Error(`目录不在工作区内：${dir}`)
  return dir
}
