import { createElement as h, useEffect, useRef } from 'react'

const IDLE_SPEED = 34
const BUSY_SPEED = 64

const prefersReducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

// 岛的外沿是一圈圆角矩形：上边、右侧、下边、左侧，四段直线加四个圆角。
// 给定路程返回脚下的点与朝向，猫沿着这条线走。
export function pointOnRim(distance, width, height) {
  const radius = Math.min(height / 2, width / 2, 30)
  const edge = Math.max(0, width - radius * 2)
  const side = Math.max(0, height - radius * 2)
  const arc = Math.PI * radius / 2
  const total = edge * 2 + side * 2 + arc * 4
  let d = ((distance % total) + total) % total
  if (d <= edge) return { x: radius + d, y: 0, angle: 0 }
  d -= edge
  if (d <= arc) {
    const t = -Math.PI / 2 + d / radius
    return { x: width - radius + radius * Math.cos(t), y: radius + radius * Math.sin(t), angle: t * 180 / Math.PI + 90 }
  }
  d -= arc
  if (d <= side) return { x: width, y: radius + d, angle: 90 }
  d -= side
  if (d <= arc) {
    const t = d / radius
    return { x: width - radius + radius * Math.cos(t), y: height - radius + radius * Math.sin(t), angle: t * 180 / Math.PI + 90 }
  }
  d -= arc
  if (d <= edge) return { x: width - radius - d, y: height, angle: 180 }
  d -= edge
  if (d <= arc) {
    const t = Math.PI / 2 + d / radius
    return { x: radius + radius * Math.cos(t), y: height - radius + radius * Math.sin(t), angle: t * 180 / Math.PI + 90 }
  }
  d -= arc
  if (d <= side) return { x: 0, y: height - radius - d, angle: 270 }
  d -= side
  const t = Math.PI + d / radius
  return { x: radius + radius * Math.cos(t), y: radius + radius * Math.sin(t), angle: t * 180 / Math.PI + 90 }
}

// 大胖橘住在岛的边线上：平时沿整圈慢慢走，走一阵就趴下歇一会儿；
// 干活时加快巡线，需要你时停下抬头看。只由房间状态驱动，不携带业务判断。
export function IslandCat({ state = 'rest' }) {
  const cat = useRef(null)
  const current = useRef(state)
  current.current = state
  useEffect(() => {
    const el = cat.current
    const host = el?.parentElement
    if (!el || !host) return undefined
    const place = (distance, walking) => {
      const width = host.clientWidth
      const height = host.clientHeight
      if (width <= 0 || height <= 0) return
      const point = pointOnRim(distance, width, height)
      const catWidth = el.offsetWidth || 54
      const catHeight = el.offsetHeight || 29
      el.style.transform = `translate(${point.x - catWidth / 2}px, ${point.y - catHeight + 1}px) rotate(${point.angle}deg)`
      el.style.opacity = '1'
      if (el.dataset.phase !== (walking ? 'walk' : 'lie')) el.dataset.phase = walking ? 'walk' : 'lie'
    }
    if (prefersReducedMotion()) {
      place(host.clientWidth / 2 - Math.min(host.clientHeight / 2, 30), false)
      return undefined
    }
    let size = { w: host.clientWidth, h: host.clientHeight }
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { size = { w: host.clientWidth, h: host.clientHeight } })
      : null
    observer?.observe(host)
    const flip = el.querySelector('.bt-cat-flip')
    let raf = 0
    let last = 0
    let distance = Math.max(0, size.w / 2 - Math.min(size.h / 2, 30))
    let action = 'walk'
    let until = 0
    let direction = 1
    let lastKind = ''
    const choose = (busy, now) => {
      const roll = Math.random()
      if (busy) {
        if (roll < 0.86) {
          action = 'walk'
          until = now + 3000 + Math.random() * 5000
          if (Math.random() < 0.25) direction = -direction
        } else {
          action = 'rest'
          until = now + 1400 + Math.random() * 1800
        }
        return
      }
      if (roll < 0.5) {
        action = 'walk'
        until = now + 3000 + Math.random() * 5000
        if (Math.random() < 0.5) direction = -direction
      } else if (roll < 0.78) {
        action = 'rest'
        until = now + 2500 + Math.random() * 3500
      } else {
        const rim = size.w > 0 ? pointOnRim(distance, size.w, size.h) : { angle: 0 }
        const atTop = Math.abs(((rim.angle % 360) + 360) % 360) < 1
        action = atTop && direction > 0 ? 'nap' : 'rest'
        until = now + (action === 'nap' ? 4500 + Math.random() * 6000 : 2200 + Math.random() * 2600)
      }
    }
    const tick = now => {
      if (last === 0) last = now
      const dt = Math.min(0.06, (now - last) / 1000)
      last = now
      const kind = current.current
      const busy = kind === 'busy'
      if (kind !== lastKind) {
        lastKind = kind
        until = 0
      }
      const canWalk = busy || kind === 'rest' || kind === 'done'
      let phase = 'lie'
      if (!canWalk) {
        action = 'rest'
      } else {
        if (now >= until) choose(busy, now)
        if (action === 'walk') {
          const before = size.w > 0 ? pointOnRim(distance, size.w, size.h) : { angle: 0 }
          const turning = Math.abs(((before.angle % 90) + 90) % 90) > 0.001
          distance += direction * (busy ? BUSY_SPEED : IDLE_SPEED) * (turning ? 0.45 : 1) * dt
          phase = 'walk'
          if (el.dataset.turn !== (turning ? 'true' : 'false')) el.dataset.turn = turning ? 'true' : 'false'
        } else {
          if (el.dataset.turn !== 'false') el.dataset.turn = 'false'
          phase = action === 'nap' ? 'nap' : 'lie'
        }
      }
      if (flip) {
        const transform = direction < 0 ? 'scaleX(-1)' : ''
        if (flip.style.transform !== transform) flip.style.transform = transform
      }
      if (size.w > 0 && size.h > 0) {
        const point = pointOnRim(distance, size.w, size.h)
        const catWidth = el.offsetWidth || 54
        const catHeight = el.offsetHeight || 29
        el.style.transform = `translate(${point.x - catWidth / 2}px, ${point.y - catHeight + 1}px) rotate(${point.angle}deg)`
        el.style.opacity = '1'
      }
      if (el.dataset.phase !== phase) el.dataset.phase = phase
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
    }
  }, [])
  return h('span', { ref: cat, className: 'bt-cat', 'data-state': state, 'data-phase': 'lie', 'aria-hidden': 'true' },
    h('span', { className: 'bt-cat-flip' },
      h('svg', { viewBox: '0 0 60 32', focusable: 'false' },
        h('defs', null,
          h('linearGradient', { id: 'bt-cat-gold', x1: 0, y1: 0, x2: 0, y2: 1 },
            h('stop', { offset: '0%', stopColor: '#f8d08a' }),
            h('stop', { offset: '52%', stopColor: '#eda945' }),
            h('stop', { offset: '100%', stopColor: '#c97c22' }))),
        h('g', { className: 'bt-cat-pose bt-cat-pose-lie' },
          h('g', { className: 'bt-cat-tail bt-cat-tail-lie' },
            h('path', { d: 'M17 28.6 C9 29.8 4 27.6 4.6 24 C5.1 21 7.8 19.6 10.4 21' }),
            h('circle', { className: 'bt-cat-tip', cx: 10.4, cy: 21, r: 2.4 })),
          h('ellipse', { className: 'bt-cat-body', cx: 31, cy: 22.4, rx: 15.4, ry: 9.2 }),
          h('ellipse', { className: 'bt-cat-belly', cx: 36, cy: 26.2, rx: 9.2, ry: 4.6 }),
          h('path', { className: 'bt-cat-stripe', d: 'M21 15.6 C22.6 14.4 24.4 14 26 14.2' }),
          h('path', { className: 'bt-cat-stripe', d: 'M26.4 14.6 C28.2 13.2 30.2 12.8 32 13.1' }),
          h('path', { className: 'bt-cat-stripe', d: 'M32.2 13.6 C34 12.4 36 12.2 37.6 12.6' }),
          h('path', { className: 'bt-cat-stripe', d: 'M17.8 21.4 C18.3 23 18.4 24.4 18.1 25.8' }),
          h('rect', { className: 'bt-cat-paw-shape bt-cat-paw-knead', x: 44, y: 27.8, width: 9, height: 4.2, rx: 2.1 }),
          h('rect', { className: 'bt-cat-paw-shape', x: 45.6, y: 29.4, width: 8, height: 2.6, rx: 1.3 })),
        h('g', { className: 'bt-cat-pose bt-cat-pose-walk' },
          h('g', { className: 'bt-cat-tail bt-cat-tail-up' },
            h('path', { d: 'M17.4 12.4 C10.4 10.6 7.4 5.6 9.2 1.6' }),
            h('circle', { className: 'bt-cat-tip', cx: 9.2, cy: 1.6, r: 2.4 })),
          h('ellipse', { className: 'bt-cat-body', cx: 31, cy: 18.2, rx: 15.2, ry: 8.8 }),
          h('ellipse', { className: 'bt-cat-belly', cx: 34, cy: 22.6, rx: 8.8, ry: 4.2 }),
          h('path', { className: 'bt-cat-stripe', d: 'M20.4 12.4 C21 13.8 21.2 15.2 21 16.6' }),
          h('path', { className: 'bt-cat-stripe', d: 'M25.2 11.4 C25.8 12.8 26 14.2 25.8 15.6' }),
          h('path', { className: 'bt-cat-stripe', d: 'M30 11 C30.6 12.4 30.8 13.8 30.6 15.2' }),
          h('g', { className: 'bt-cat-legs' },
            h('rect', { className: 'bt-cat-leg bt-cat-leg-a', x: 19.6, y: 22, width: 4.4, height: 9.6, rx: 2.2 }),
            h('rect', { className: 'bt-cat-leg bt-cat-leg-b', x: 24.8, y: 22, width: 4.4, height: 9.6, rx: 2.2 }),
            h('rect', { className: 'bt-cat-leg bt-cat-leg-a', x: 35.6, y: 22, width: 4.4, height: 9.6, rx: 2.2 }),
            h('rect', { className: 'bt-cat-leg bt-cat-leg-b', x: 40.8, y: 22, width: 4.4, height: 9.6, rx: 2.2 }))),
        h('g', { className: 'bt-cat-head' },
          h('ellipse', { className: 'bt-cat-body', cx: 47.4, cy: 15, rx: 10.4, ry: 9.9 }),
          h('g', { className: 'bt-cat-ears' },
            h('path', { className: 'bt-cat-body', d: 'M39.8 9.6 C38.4 3.4 41 1.4 44.4 5.2 C45 5.8 45.6 6.8 46 7.6 Z' }),
            h('path', { className: 'bt-cat-body', d: 'M55.4 9.2 C56.4 3.2 53.6 1.2 50.4 4.8 C49.8 5.4 49.2 6.4 48.8 7.4 Z' }),
            h('path', { className: 'bt-cat-inner', d: 'M40.8 8.2 C39.8 4.6 41.4 3.4 43.4 5.6 C43.8 6.1 44.2 6.8 44.4 7.3 Z' }),
            h('path', { className: 'bt-cat-inner', d: 'M54.4 7.9 C55.4 4.4 53.8 3.2 51.8 5.4 C51.4 5.9 51 6.6 50.8 7.1 Z' })),
          h('ellipse', { className: 'bt-cat-muzzle', cx: 47.4, cy: 20.4, rx: 6.2, ry: 4 }),
          h('path', { className: 'bt-cat-crown', d: 'M45.1 6.6 H49.7 M45.7 8.2 H49.1 M45.1 9.8 H49.7 M47.4 6.2 V10.2' }),
          h('g', { className: 'bt-cat-eyes' },
            h('circle', { className: 'bt-cat-socket', cx: 43.4, cy: 15.4, r: 4.8 }),
            h('circle', { className: 'bt-cat-socket', cx: 51.4, cy: 15.4, r: 4.8 }),
            h('circle', { className: 'bt-cat-eye', cx: 43.4, cy: 15.4, r: 4.1 }),
            h('circle', { className: 'bt-cat-eye', cx: 51.4, cy: 15.4, r: 4.1 }),
            h('ellipse', { className: 'bt-cat-pupil', cx: 43.5, cy: 15.9, rx: 1.9, ry: 2.6 }),
            h('ellipse', { className: 'bt-cat-pupil', cx: 51.5, cy: 15.9, rx: 1.9, ry: 2.6 }),
            h('circle', { className: 'bt-cat-glint', cx: 42.4, cy: 14.2, r: 0.8 }),
            h('circle', { className: 'bt-cat-glint', cx: 50.4, cy: 14.2, r: 0.8 })),
          h('path', { className: 'bt-cat-nose', d: 'M46.3 19.6 L48.5 19.6 L47.4 21 Z' }),
          h('path', { className: 'bt-cat-mouth', d: 'M45.7 22.1 Q46.55 22.9 47.4 22.2 Q48.25 22.9 49.1 22.1' })),
        h('g', { className: 'bt-cat-snore' },
          h('g', { className: 'bt-cat-napbubble' },
            h('circle', { className: 'bt-cat-bigbubble', cx: 55.4, cy: 23.2, r: 5 }),
            h('circle', { className: 'bt-cat-bigbubble-shine', cx: 53.6, cy: 21.4, r: 1.1 })),
          h('path', { className: 'bt-cat-z bt-cat-z1', d: 'M50.6 6.6 h4.2 v.8 l-3.2 2.8 h3.2 v.9 h-4.2 v-.8 l3.2-2.8 h-3.2 z' }),
          h('path', { className: 'bt-cat-z bt-cat-z2', d: 'M54.9 3.3 h3.4 v.7 l-2.6 2.3 h2.6 v.7 h-3.4 v-.7 l2.6-2.3 h-2.6 z' }),
          h('path', { className: 'bt-cat-z bt-cat-z3', d: 'M58.4 .5 h2.8 v.6 l-2.1 1.9 h2.1 v.6 h-2.8 v-.6 l2.1-1.9 h-2.1 z' })))))
}

export const CAT_CSS = `
.bt-cat{position:absolute;top:0;left:0;z-index:3;width:54px;height:29px;pointer-events:none;opacity:0;transform-origin:50% 100%;--cat-body:#e5973f;--cat-belly:#f8e7c9;--cat-muzzle:#f8e7c9;--cat-inner:#d97a58;--cat-stripe:#8f4b1c;--cat-eye:#f9f1d8;--cat-pupil:#2a1a0e;--cat-paw:#f8e7c9;--cat-nose:#c0563f;--cat-snore:#a45f24;--cat-rim:rgba(255,255,255,.22);filter:drop-shadow(0 1px 1px rgba(60,30,0,.18))}
body[data-ds-dark-theme] .bt-cat{--cat-body:url(#bt-cat-gold);--cat-belly:#ffeac6;--cat-muzzle:#ffeac6;--cat-inner:#e8a37f;--cat-stripe:#9a5a1c;--cat-eye:#fff7dd;--cat-pupil:#241806;--cat-paw:#ffeac6;--cat-nose:#b25a44;--cat-snore:#ffe6b0;--cat-rim:rgba(255,230,170,.45);filter:drop-shadow(0 1px 2px rgba(0,0,0,.4))}
.bt-cat-flip{display:block;width:100%;height:100%}
.bt-cat svg{display:block;width:100%;height:100%;overflow:visible}
.bt-cat-body{fill:var(--cat-body);stroke:var(--cat-rim);stroke-width:.6;stroke-linejoin:round}
.bt-cat-belly,.bt-cat-muzzle{fill:var(--cat-muzzle)}
.bt-cat-inner{fill:var(--cat-inner)}
.bt-cat-stripe{fill:none;stroke:var(--cat-stripe);stroke-width:1.7;stroke-linecap:round}
.bt-cat-crown{fill:none;stroke:var(--cat-stripe);stroke-width:1.2;stroke-linecap:round}
.bt-cat-tip{fill:var(--cat-stripe)}
.bt-cat-socket{fill:var(--cat-pupil)}
.bt-cat-eye{fill:var(--cat-eye)}
.bt-cat-pupil{fill:var(--cat-pupil);animation:bt-cat-glance 9.2s ease-in-out infinite}
.bt-cat-glint{fill:rgba(255,255,255,.92)}
.bt-cat-nose{fill:var(--cat-nose)}
.bt-cat-mouth{fill:none;stroke:var(--cat-stripe);stroke-width:.9;stroke-linecap:round}
.bt-cat-paw-shape{fill:var(--cat-paw)}
.bt-cat-pose-walk{display:none}
.bt-cat[data-phase=walk] .bt-cat-pose-walk{display:block}
.bt-cat[data-phase=walk] .bt-cat-pose-lie{display:none}
.bt-cat-pose-lie{transform-box:view-box;transform-origin:31px 31px;animation:bt-cat-breathe 3.9s ease-in-out infinite}
.bt-cat-tail-lie{transform-box:view-box;transform-origin:17px 28.6px;animation:bt-cat-sway 5.4s cubic-bezier(.45,0,.25,1) infinite}
.bt-cat-tail-lie path{fill:none;stroke:var(--cat-body);stroke-width:4.4;stroke-linecap:round}
.bt-cat-tail-up{transform-box:view-box;transform-origin:17.4px 12.4px;animation:bt-cat-sway-up 1.05s cubic-bezier(.45,0,.25,1) infinite}
.bt-cat-tail-up path{fill:none;stroke:var(--cat-body);stroke-width:4.4;stroke-linecap:round}
.bt-cat-leg{fill:var(--cat-body);transform-box:fill-box;transform-origin:50% 0}
.bt-cat[data-phase=walk] .bt-cat-leg-a{animation:bt-cat-step 1.05s cubic-bezier(.45,0,.25,1) infinite}
.bt-cat[data-phase=walk] .bt-cat-leg-b{animation:bt-cat-step 1.05s cubic-bezier(.45,0,.25,1) infinite;animation-delay:-.52s}
.bt-cat[data-phase=walk] svg{animation:bt-cat-bob 1.05s ease-in-out infinite}
.bt-cat[data-turn=true] svg{animation:bt-cat-turnhop .46s cubic-bezier(.45,0,.25,1) infinite}
.bt-cat-eyes{transform-box:view-box;transform-origin:47.4px 15.4px;animation:bt-cat-blink 6.4s linear infinite}
.bt-cat-ears{transform-box:view-box;transform-origin:47.4px 12px;animation:bt-cat-ear-twitch 6.9s ease-in-out infinite}
.bt-cat-paw-knead{transform-box:fill-box;transform-origin:50% 100%;animation:bt-cat-knead 4.6s ease-in-out infinite}
.bt-cat[data-phase=lie] .bt-cat-head{transform-box:view-box;transform-origin:44px 22px;animation:bt-cat-idle-tilt 7.4s cubic-bezier(.45,0,.25,1) infinite}
.bt-cat-snore{display:none}
.bt-cat[data-phase=nap] .bt-cat-snore{display:block}
.bt-cat-napbubble{display:none;transform-box:fill-box;transform-origin:30% 70%;animation:bt-cat-bigbubble 4.2s ease-in-out infinite}
.bt-cat[data-phase=nap] .bt-cat-napbubble{display:block}
.bt-cat-bigbubble{fill:rgba(255,255,255,.18);stroke:var(--cat-snore);stroke-width:.7}
.bt-cat-bigbubble-shine{fill:rgba(255,255,255,.8)}
.bt-cat-z{fill:var(--cat-snore);transform-box:view-box;animation:bt-cat-doze 3.2s ease-in-out infinite}
.bt-cat-z2{animation-delay:.55s}
.bt-cat-z3{animation-delay:1.1s}
.bt-cat[data-phase=nap] .bt-cat-eyes{transform:scaleY(.08);animation:none}
.bt-cat[data-phase=nap] .bt-cat-head{animation:none}
.bt-cat[data-phase=nap] .bt-cat-pose-lie{animation-duration:6.8s}
.bt-cat[data-phase=nap] .bt-cat-tail-lie{animation-duration:7.4s}
.bt-cat[data-phase=nap] .bt-cat-paw-knead{animation:none}
.bt-cat[data-state=needs] .bt-cat-head{transform-box:view-box;transform-origin:44px 22px;animation:bt-cat-look 3.6s cubic-bezier(.45,0,.25,1) infinite}
.bt-cat[data-state=done] .bt-cat-tail-lie{animation-duration:2.8s}
@keyframes bt-cat-bob{0%,100%{transform:none}50%{transform:translateY(-.8px) rotate(-1deg)}}
@keyframes bt-cat-turnhop{0%,100%{transform:none}50%{transform:translateY(-2.6px) rotate(-3deg)}}
@keyframes bt-cat-step{0%,100%{transform:rotate(8deg)}50%{transform:rotate(-8deg)}}
@keyframes bt-cat-breathe{0%,100%{transform:scale(1)}34%{transform:scale(1.012,.985)}62%{transform:scale(1)}78%{transform:scale(1.028,.972)}86%{transform:scale(1.006,.994)}}
@keyframes bt-cat-sway{0%,100%{transform:rotate(-3deg)}30%{transform:rotate(4deg)}52%{transform:rotate(-3deg)}60%{transform:rotate(-11deg)}66%{transform:rotate(5deg)}72%{transform:rotate(-3deg)}}
@keyframes bt-cat-sway-up{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(6deg)}}
@keyframes bt-cat-blink{0%,91%,96%,100%{transform:scaleY(1)}93.5%{transform:scaleY(.1)}}
@keyframes bt-cat-look{0%,100%{transform:rotate(0)}50%{transform:rotate(-4deg)}}
@keyframes bt-cat-idle-tilt{0%,100%{transform:rotate(0)}40%{transform:rotate(-2.5deg)}70%{transform:rotate(1.5deg)}}
@keyframes bt-cat-ear-twitch{0%,84%,100%{transform:none}86%{transform:rotate(2.2deg)}88%{transform:none}90%{transform:rotate(-1.8deg)}92%{transform:none}}
@keyframes bt-cat-knead{0%,68%,100%{transform:none}73%{transform:translateY(-.8px) rotate(-5deg)}77%{transform:none}82%{transform:translateY(-.8px) rotate(-5deg)}86%{transform:none}}
@keyframes bt-cat-glance{0%,42%,100%{transform:translateX(0)}52%,64%{transform:translateX(.9px)}76%,88%{transform:translateX(-.7px)}}
@keyframes bt-cat-doze{0%{opacity:0;transform:translateY(1.6px)}25%{opacity:.92}62%{opacity:.72}100%{opacity:0;transform:translateY(-3.4px)}}
@keyframes bt-cat-bigbubble{0%{transform:scale(.22);opacity:0}10%{opacity:.9}55%{transform:scale(.86);opacity:.85}78%{transform:scale(1.12);opacity:.8}84%,100%{transform:scale(1.2);opacity:0}}
@media (prefers-reduced-motion:reduce){.bt-cat *,.bt-cat svg{animation:none!important}}
`
