// 灵宠找路：8 邻域 A* + octile 启发式 + 禁止贴角穿墙 + 视线捷径平滑。
// 演示页 ui/lingchong-lab/index.html 内嵌同源实现，方便 file:// 直接打开；
// 这里是可复用、可单测的项目版本。
const DIRS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

export class Pathfinder {
  constructor({ width = 900, height = 500, cell = 25, obstacles = [], margin = 21 } = {}) {
    this.cell = cell
    this.cols = Math.floor(width / cell)
    this.rows = Math.floor(height / cell)
    this.obstacles = obstacles
    this.margin = margin // 灵宠自身半径，把障碍膨胀一圈，避免贴着石头擦过去
    this.blocked = new Uint8Array(this.cols * this.rows)
    this.rebuild()
  }

  idx(c, r) { return r * this.cols + c }
  center(i) { return { x: ((i % this.cols) + .5) * this.cell, y: (Math.floor(i / this.cols) + .5) * this.cell } }
  cellOf(p) {
    return {
      c: Math.max(0, Math.min(this.cols - 1, Math.floor(p.x / this.cell))),
      r: Math.max(0, Math.min(this.rows - 1, Math.floor(p.y / this.cell))),
    }
  }

  rebuild() {
    this.blocked.fill(0)
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
      const p = this.center(this.idx(c, r))
      if (c === 0 || r === 0 || c === this.cols - 1 || r === this.rows - 1) {
        this.blocked[this.idx(c, r)] = 1
        continue
      }
      for (const o of this.obstacles) {
        if (Math.hypot(p.x - o.x, p.y - o.y) < o.r + this.margin) {
          this.blocked[this.idx(c, r)] = 1
          break
        }
      }
    }
  }

  nearestFree(c0, r0) {
    if (!this.blocked[this.idx(c0, r0)]) return this.idx(c0, r0)
    for (let ring = 1; ring < Math.max(this.cols, this.rows); ring++) {
      for (let dr = -ring; dr <= ring; dr++) for (let dc = -ring; dc <= ring; dc++) {
        const c = c0 + dc, r = r0 + dr
        if (c > 0 && r > 0 && c < this.cols - 1 && r < this.rows - 1 && !this.blocked[this.idx(c, r)]) return this.idx(c, r)
      }
    }
    return -1
  }

  heuristic(i, goal) {
    const dx = Math.abs(i % this.cols - goal % this.cols)
    const dy = Math.abs(Math.floor(i / this.cols) - Math.floor(goal / this.cols))
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)
  }

  lineOfSight(a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const n = Math.max(1, Math.ceil(d / 5))
    for (let k = 1; k < n; k++) {
      const p = { x: a.x + (b.x - a.x) * k / n, y: a.y + (b.y - a.y) * k / n }
      const q = this.cellOf(p)
      if (this.blocked[this.idx(q.c, q.r)]) return false
    }
    return true
  }

  // 返回 { path: 世界坐标点列, visited: A* 展开过的格 }；不可达时 path 为空。
  find(start, goal) {
    const sc = this.cellOf(start), gc = this.cellOf(goal)
    const s = this.nearestFree(sc.c, sc.r), g = this.nearestFree(gc.c, gc.r)
    if (s < 0 || g < 0) return { path: [], visited: [] }
    const dist = new Float64Array(this.cols * this.rows).fill(Infinity)
    const from = new Int32Array(this.cols * this.rows).fill(-1)
    const closed = new Uint8Array(this.cols * this.rows)
    const open = [{ i: s, f: this.heuristic(s, g) }]
    const visited = []
    dist[s] = 0

    while (open.length) {
      let best = 0
      for (let k = 1; k < open.length; k++) if (open[k].f < open[best].f) best = k
      const cur = open.splice(best, 1)[0]
      if (closed[cur.i]) continue
      closed[cur.i] = 1
      visited.push(cur.i)

      if (cur.i === g) {
        const cells = []
        for (let at = g; at !== -1; at = from[at]) cells.push(at)
        cells.reverse()
        const points = cells.map(i => this.center(i))
        points[0] = { x: start.x, y: start.y }
        const smooth = [points[0]]
        let i = 0
        while (i < points.length - 1) {
          let j = points.length - 1
          for (; j > i + 1; j--) if (this.lineOfSight(points[i], points[j])) break
          smooth.push(points[j])
          i = j
        }
        const last = smooth[smooth.length - 1]
        if (!this.blocked[this.idx(gc.c, gc.r)] && this.lineOfSight(last, goal)) smooth.push({ x: goal.x, y: goal.y })
        return { path: smooth, visited }
      }

      const c = cur.i % this.cols, r = Math.floor(cur.i / this.cols)
      for (const [dc, dr, cost] of DIRS) {
        const nc = c + dc, nr = r + dr
        if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue
        const n = this.idx(nc, nr)
        if (this.blocked[n] || closed[n]) continue
        if (dc && dr && (this.blocked[this.idx(c + dc, r)] || this.blocked[this.idx(c, r + dr)])) continue
        const nd = dist[cur.i] + cost
        if (nd < dist[n]) {
          dist[n] = nd
          from[n] = cur.i
          open.push({ i: n, f: nd + this.heuristic(n, g) })
        }
      }
    }
    return { path: [], visited }
  }
}
