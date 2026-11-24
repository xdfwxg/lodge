// 基座响应的“形状”：键和类型，不带任何用户数据。
// 录制一次真实 8799 响应，回放时用合成值跑适配层；真实基座新增/删除字段从此可查。
const DEPTH_LIMIT = 12

export const shapeOf = (value, depth = 0) => {
  if (depth > DEPTH_LIMIT) return 'depth'
  if (value === null) return 'null'
  if (Array.isArray(value)) return { type: 'array', items: value.length === 0 ? null : shapeOf(value[0], depth + 1) }
  if (typeof value === 'object') {
    return {
      type: 'object',
      keys: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item, depth + 1)])),
    }
  }
  return typeof value
}

// 配置里可能有密钥和账户信息，只记键名，不记值，也不往下递归。
const keysOnly = value => ({
  type: 'keys',
  keys: value !== null && typeof value === 'object' ? Object.keys(value) : [],
})

export const shapeEndpoints = ({ instances, bootstrap, config }) => ({
  instances: shapeOf(instances),
  bootstrap: shapeOf({ bots: bootstrap?.bots ?? [], groups: bootstrap?.groups ?? [] }),
  config: {
    type: 'object',
    keys: Object.fromEntries(Object.entries(config ?? {}).map(([key, value]) => [
      key,
      key === 'features' ? keysOnly(value) : 'present',
    ])),
  },
})

const join = (path, key) => (path === '' ? String(key) : `${path}.${key}`)

// 只报结构差异：缺失是契约破了，新增是提示，不是失败。
export const compareShapes = (expected, actual) => {
  const missing = []
  const extra = []
  const walk = (left, right, path) => {
    if (left === null || left === undefined || right === null || right === undefined) return
    if (typeof left === 'string') {
      if (left === 'present') return
      if (left !== 'depth' && typeof right === 'object') missing.push(`${path} (type ${left} -> ${right?.type ?? typeof right})`)
      return
    }
    if (left.type === 'keys') {
      const actualKeys = right.type === 'keys' ? right.keys : Object.keys(right.keys ?? {})
      for (const key of left.keys) if (!actualKeys.includes(key)) missing.push(join(path, key))
      for (const key of actualKeys) if (!left.keys.includes(key)) extra.push(join(path, key))
      return
    }
    if (left.type === 'array') {
      if (right.type !== 'array') {
        missing.push(`${path} (array -> ${right.type ?? typeof right})`)
        return
      }
      if (left.items !== null && right.items !== null && right.items !== undefined) walk(left.items, right.items, `${path}[]`)
      return
    }
    if (left.type === 'object') {
      if (right.type !== 'object') {
        missing.push(`${path} (object -> ${right.type ?? typeof right})`)
        return
      }
      for (const [key, child] of Object.entries(left.keys ?? {})) {
        if (!(key in (right.keys ?? {}))) missing.push(join(path, key))
        else walk(child, right.keys[key], join(path, key))
      }
      for (const key of Object.keys(right.keys ?? {})) {
        if (!(key in (left.keys ?? {}))) extra.push(join(path, key))
      }
    }
  }
  walk(expected, actual, '')
  return { missing, extra }
}

const placeholder = value => {
  if (typeof value === 'string') return 'sample'
  if (typeof value === 'number') return 0
  if (typeof value === 'boolean') return false
  return null
}

// 用形状合成一份可跑的数据；枚举字段由调用方覆盖成合法值。
export const sampleFromShape = (shape, overrides = {}, path = '') => {
  if (path !== '' && Object.hasOwn(overrides, path)) return overrides[path]
  if (shape === null || shape === undefined) return null
  if (typeof shape === 'string') return placeholder(shape)
  if (shape.type === 'array') return shape.items === null ? [] : [sampleFromShape(shape.items, overrides, join(path, '0'))]
  if (shape.type === 'keys') return Object.fromEntries(shape.keys.map(key => [key, false]))
  if (shape.type === 'object') {
    return Object.fromEntries(Object.entries(shape.keys ?? {}).map(([key, child]) => [
      key,
      sampleFromShape(child, overrides, join(path, key)),
    ]))
  }
  return null
}
