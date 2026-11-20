// 侧栏宽度与折叠的本地偏好；视图只消费结果，不直接碰 localStorage。
export const SIDE_MIN = 200
export const SIDE_MAX = 480
export const RAIL_WIDTH = 56
export const COLLAPSE_AT = 150

export const clampSide = value => Math.min(SIDE_MAX, Math.max(SIDE_MIN, value))

export const readSidebarLayout = () => {
  try {
    const width = Number.parseFloat(globalThis.localStorage?.getItem('lodge:side-width') ?? '')
    return {
      width: Number.isFinite(width) ? clampSide(width) : null,
      collapsed: globalThis.localStorage?.getItem('lodge:side-collapsed') === '1',
    }
  } catch {
    return { width: null, collapsed: false }
  }
}

export const writeSidebarWidth = value => {
  try { globalThis.localStorage?.setItem('lodge:side-width', `${value}px`) } catch {}
}

export const writeSidebarCollapsed = value => {
  try { globalThis.localStorage?.setItem('lodge:side-collapsed', value ? '1' : '0') } catch {}
}
