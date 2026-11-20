import { createElement as h, useEffect, useId, useRef } from 'react'
const standingArt = new URL('../assets/lingchong-line.png', import.meta.url).href

const WALK_SPEED = 34
const CHASE_SPEED = 62
const TROT_SPEED = 48
const HOME_PAD = 4
const ART_W = 385
const ART_H = 195
// 线稿脚下留 30px 空白；舞台按原图坐标下沉同样距离，四足才贴住岛面。
const ART_GROUND = 30
const YAWN_DUR = 1.5
const SLEEP_AFTER = 38
const LEG_TUCK = [-68, 68, 62, -62]

const prefersReducedMotion = () => typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

// 朏朏，《山海经》里“状如狸而白尾有鬣，养之可以已忧”的小兽。
// 简笔线稿：圆头、短腿、白尾、颈鬣；聊天室陪伴，工作室守进度。
export const lingchongPose = (state, mode = 'chat', progress = 0) => {
  const at = Math.min(1, Math.max(0, Number(progress) || 0))
  const step = 0.3 + 0.4 * at
  if (state === 'busy') return { phase: 'walk', spot: mode === 'studio' ? step : 0.3 }
  if (state === 'needs') return { phase: 'sit', spot: mode === 'studio' ? step : 0.5 }
  if (state === 'done') return { phase: 'nap', spot: 0.72 }
  return { phase: 'lie', spot: mode === 'studio' ? step : 0.3 }
}

export function lingchongSpot(state, width, widthOfLingchong = 112, mode = 'chat', progress = 0) {
  const { spot } = lingchongPose(state, mode, progress)
  const half = widthOfLingchong / 2
  const min = HOME_PAD + half
  const max = Math.max(min, width - HOME_PAD - half)
  return Math.min(max, Math.max(min, width * spot))
}

export function Lingchong({ state = 'rest', mode = 'chat', progress = 0, onActivate = null }) {
  const lingchong = useRef(null)
  // 线稿缩到 112px 后笔画会被平均成半透明；用 alpha 斜率把线条压回实心墨色。
  const inkId = `lingchong-ink-${useId().replace(/:/g, '')}`
  const current = useRef({ state, mode, progress })
  current.current = { state, mode, progress }
  const flip = useRef(null)
  const stage = useRef(null)
  const tail = useRef(null)
  const body = useRef(null)
  const legs = useRef([{ current: null }, { current: null }, { current: null }, { current: null }])
  const blink = useRef(null)
  const yawn = useRef(null)
  const mouth = useRef(null)
  const sparks = useRef(null)
  const butterfly = useRef(null)
  const zzz = useRef(null)
  const hopRequest = useRef(null)
  const wakeRequest = useRef(false)

  const sprinkle = (kind = 'spark') => {
    const field = sparks.current
    if (!field) return
    for (let k = 0; k < 5; k += 1) {
      const node = document.createElement('span')
      node.className = 'spark'
      node.dataset.kind = kind
      node.textContent = kind === 'heart' ? (k % 2 ? '♥' : '♡') : (k % 2 ? '✦' : '❀')
      node.style.left = `${28 + Math.random() * 26}px`
      node.style.top = `${4 + Math.random() * 12}px`
      node.style.animationDelay = `${k * 0.08}s`
      field.appendChild(node)
      setTimeout(() => node.remove(), 1250)
    }
  }

  useEffect(() => {
    const el = lingchong.current
    const host = el?.parentElement
    if (!el || !host) return undefined
    const reduced = prefersReducedMotion()
    let x = null
    let direction = 1
    let last = 0
    let raf = 0
    let gait = 0
    let tailPhase = 0
    let hop = 0
    let hopT = 0
    let hopH = 0
    let happyT = 0
    let blinkAt = 3.2
    let blinkUntil = 0
    let yawnT = 0
    let yawnAt = 18 + Math.random() * 8
    let idleT = 0
    let postureMix = 0
    let wakeUntil = 0
    let chase = null
    let nextChaseAt = 22 + Math.random() * 18
    let hovering = false
    let pointerClientX = null
    let hoverX = null
    let cuddled = false
    let seconds = 0

    const place = (nextX, phase) => {
      const width = host.clientWidth
      if (width <= 0) return nextX
      const petWidth = el.offsetWidth || 112
      const petHeight = el.offsetHeight || 57
      const min = HOME_PAD + petWidth / 2
      const max = Math.max(min, width - HOME_PAD - petWidth / 2)
      const at = Math.min(max, Math.max(min, nextX))
      el.style.transform = `translate(${at - petWidth / 2}px, ${-petHeight + 1}px)`
      el.style.opacity = '1'
      if (el.dataset.phase !== phase) el.dataset.phase = phase
      return at
    }

    const targetFor = (kind, mode, progress) => lingchongSpot(kind, host.clientWidth, el.offsetWidth || 112, mode, progress)

    const endChase = () => {
      if (chase === null) return
      chase = null
      nextChaseAt = seconds + 32
      if (butterfly.current) butterfly.current.classList.remove('on')
    }
    const onEnter = event => {
      hovering = true
      pointerClientX = event.clientX
      idleT = 0
      yawnT = 0
      wakeUntil = Math.max(wakeUntil, seconds + 1.5)
      endChase()
    }
    const onMove = event => {
      if (hovering) pointerClientX = event.clientX
    }
    const onLeave = () => {
      hovering = false
      pointerClientX = null
      hoverX = null
      cuddled = false
    }
    host.addEventListener('pointerenter', onEnter)
    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)

    if (reduced) {
      const { state: kind, mode, progress } = current.current
      x = targetFor(kind, mode, progress)
      place(x, lingchongPose(kind, mode, progress).phase)
      host.removeEventListener('pointerenter', onEnter)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      return undefined
    }

    const step = timestamp => {
      if (last === 0) last = timestamp
      const dt = Math.min(0.06, (timestamp - last) / 1000)
      last = timestamp
      seconds += dt
      const { state: kind, mode, progress } = current.current
      const width = host.clientWidth
      if (width <= 0) {
        raf = requestAnimationFrame(step)
        return
      }
      const petWidth = el.offsetWidth || 112
      const scale = petWidth / ART_W
      // 岛展开会改变自身左沿；每帧按光标重算，宠物才不会走到旧位置。
      hoverX = hovering && pointerClientX !== null
        ? pointerClientX - host.getBoundingClientRect().left
        : null
      if (x === null) x = targetFor(kind, mode, progress)

      if (wakeRequest.current) {
        wakeRequest.current = false
        wakeUntil = seconds + 3.2
        idleT = 0
        nextChaseAt = seconds + 26 + Math.random() * 20
      }

      const done = kind === 'done'
      const awake = wakeUntil > seconds
      // 聊天室安静十秒先趴下休息（睁眼），再久才睡着（闭眼、飘 z）；交付后直接睡。
      const resting = !done && kind === 'rest' && !hovering && chase === null && !awake
      const sleeping = done ? !awake : resting && idleT > SLEEP_AFTER
      const postureTarget = done ? (awake ? 0 : 1) : (resting && idleT > 10 ? 1 : 0)
      postureMix = Math.min(1, Math.max(0, postureMix + Math.sign(postureTarget - postureMix) * dt / 0.7))
      const sm = postureMix * postureMix * (3 - 2 * postureMix)

      // 追蝴蝶：只在聊天室安静时出现；没追上三次或玩够了就飞走。
      const canChase = kind === 'rest' && !done && !sleeping && !hovering && idleT > 6 && seconds > nextChaseAt
      if (chase === null && canChase) {
        yawnT = 0
        chase = {
          t: 0,
          misses: 0,
          anchor: Math.min(width - 30, Math.max(30, x)),
          turnAt: seconds + 2.4,
          worldX: Math.min(width - 30, Math.max(30, x)),
        }
        if (butterfly.current) butterfly.current.classList.add('on')
      }
      let chaseTarget = null
      if (chase !== null) {
        chase.t += dt
        if (seconds > chase.turnAt) {
          chase.anchor = 30 + Math.random() * Math.max(1, width - 60)
          chase.turnAt = seconds + 2.4 + Math.random() * 2
        }
        chase.worldX = Math.min(width - 24, Math.max(24,
          chase.anchor + 40 * Math.sin(seconds * 1.8) + 14 * Math.sin(seconds * 3.3)))
        chaseTarget = chase.worldX
        if (Math.abs(chase.worldX - x) < 15 && hopT <= 0) {
          hopT = 0.55
          hopH = 16
          happyT = 1.2
          sprinkle()
          chase.misses += 1
          chase.anchor = Math.min(width - 30, Math.max(30,
            chase.worldX + (chase.worldX < width / 2 ? width * 0.4 : -width * 0.4)))
          chase.turnAt = seconds + 1.4
        }
        if (chase.t > 14 || chase.misses >= 3) {
          chase = null
          nextChaseAt = seconds + 40 + Math.random() * 30
          if (butterfly.current) butterfly.current.classList.remove('on')
        }
      }

      let phase = lingchongPose(kind, mode, progress).phase
      let moved = 0
      if (kind === 'busy') {
        const min = HOME_PAD + petWidth / 2
        const max = Math.max(min, width - HOME_PAD - petWidth / 2)
        const focus = targetFor('rest', mode, progress)
        const studioMin = mode === 'studio' ? Math.max(min, focus - width * 0.05) : min
        const studioMax = mode === 'studio' ? Math.min(max, focus + width * 0.05) : max
        const before = x
        if (x < studioMin) {
          x = Math.min(studioMin, x + TROT_SPEED * dt)
          direction = 1
        } else if (x > studioMax) {
          x = Math.max(studioMax, x - TROT_SPEED * dt)
          direction = -1
        } else {
          x += direction * TROT_SPEED * dt
          if (x >= studioMax) {
            x = studioMax
            direction = -1
          } else if (x <= studioMin) {
            x = studioMin
            direction = 1
          }
        }
        moved = Math.abs(x - before)
        phase = 'walk'
      } else {
        const min = HOME_PAD + petWidth / 2
        const max = Math.max(min, width - HOME_PAD - petWidth / 2)
        const cuddle = !done && hoverX !== null ? Math.min(max, Math.max(min, hoverX)) : null
        const target = cuddle ?? chaseTarget ?? targetFor(kind, mode, progress)
        const delta = target - x
        if (Math.abs(delta) > 0.8) {
          direction = delta > 0 ? 1 : -1
          const speed = cuddle !== null ? 72 : chaseTarget === null ? WALK_SPEED : CHASE_SPEED
          const stepPx = Math.min(Math.abs(delta), speed * dt)
          x += direction * stepPx
          moved = stepPx
          phase = 'walk'
        } else {
          x = target
        }
        // 走到人面前就贴一下：冒爱心、尾巴摇快；离开前只贴一次。
        if (cuddle !== null && Math.abs(target - x) < 6 && !cuddled) {
          cuddled = true
          happyT = 1.2
          sprinkle('heart')
        }
      }
      const walking = moved > 0.01 || kind === 'busy'
      if (walking) gait += (kind === 'busy' && moved < 0.01 ? dt * 1.6 : moved / scale / 90)
      if (walking || chaseTarget !== null || hoverX !== null) idleT = 0
      else idleT += dt

      // 待机久了打个哈欠；睡着、追蝴蝶、贴着人和赶路时不打。
      if (!done && !walking && chase === null && !sleeping && !hovering && yawnT <= 0) {
        yawnAt -= dt
        if (yawnAt <= 0) {
          yawnT = YAWN_DUR
          yawnAt = 24 + Math.random() * 12
        }
      }
      const yawning = yawnT > 0
      if (yawning) yawnT = Math.max(0, yawnT - dt)

      // 眨眼；趴下睡觉时一直闭眼。
      if (!sleeping) {
        blinkAt -= dt
        if (blinkAt <= 0) {
          blinkUntil = seconds + 0.13
          blinkAt = 2.6 + Math.random() * 4.2
        }
      }
      const blinking = sleeping || yawning || seconds < blinkUntil
      if (blink.current) blink.current.classList.toggle('on', blinking)

      if (hopRequest.current !== null) {
        hopT = hopRequest.current.hopT
        hopH = hopRequest.current.hopH
        happyT = 1.6
        hopRequest.current = null
      }
      if (happyT > 0) happyT = Math.max(0, happyT - dt)
      if (hopT > 0) {
        hopT = Math.max(0, hopT - dt)
        hop = Math.sin((1 - hopT / 0.5) * Math.PI) * hopH
      } else hop = 0

      const p = gait * Math.PI * 2
      const amp = walking ? 18 : 0
      const stretch = yawning ? Math.sin((1 - yawnT / YAWN_DUR) * Math.PI) : 0
      const offsets = [0, 0.5, 0.25, 0.75]
      legs.current.forEach((ref, k) => {
        const node = ref.current
        if (!node) return
        const ph = p + offsets[k] * Math.PI * 2
        const a = walking ? Math.sin(ph) * amp : 0
        const lift = walking ? Math.max(0, Math.sin(ph)) * 4 : 0
        const reach = k < 2 ? -18 * stretch : 0
        const rotate = a * (1 - sm) + LEG_TUCK[k] * sm + reach
        const liftY = -lift * (1 - sm) + 7 * sm
        node.style.transform = `rotate(${rotate.toFixed(2)}deg) translateY(${liftY.toFixed(2)}px) scaleY(${(1 - 0.74 * sm).toFixed(3)})`
        node.style.opacity = String(1 - sm)
      })
      const bob = (walking ? Math.abs(Math.sin(p * 2)) * 2.3 : 0) * (1 - stretch * 0.5)
      const breath = (walking ? 1 : 1 + Math.sin(seconds * (sm > 0.5 ? 1 : 1.85)) * (sm > 0.5 ? 0.014 : 0.009)) + 0.02 * stretch
      const bodyRot = (walking ? Math.sin(p) * 0.5 : 0) - 5 * sm + 2.5 * stretch
      if (body.current) {
        body.current.style.transform = `translateY(${(-bob + 6 * sm).toFixed(2)}px) rotate(${bodyRot.toFixed(2)}deg) scaleX(${(1 + 0.03 * stretch).toFixed(3)}) scaleY(${breath.toFixed(4)})`
      }
      tailPhase += dt * (walking ? 5.2 : happyT > 0 ? 7 : 1.25)
      const tailAmp = happyT > 0 ? 14 : walking ? 10 : 6
      if (tail.current) {
        const tailRot = Math.sin(tailPhase) * tailAmp * (1 - sm) + (-22 + Math.sin(tailPhase * 0.5) * 2) * sm + 8 * stretch
        tail.current.style.transform = `rotate(${tailRot.toFixed(2)}deg)`
      }
      if (flip.current) {
        // 线稿默认朝左；往右走才镜像，不然会倒着走。
        const dirSign = direction > 0 ? -1 : 1
        flip.current.style.transform =
          `scale(${(dirSign * (1 + 0.05 * sm)).toFixed(4)}, ${(1 - 0.22 * sm).toFixed(4)}) translateY(${(13.5 * sm * (petWidth / 112)).toFixed(2)}px)`
      }

      if (yawn.current) yawn.current.classList.toggle('on', yawning)
      if (mouth.current) {
        if (yawning) {
          const k = 1 - yawnT / YAWN_DUR
          const open = Math.min(1, k * 4, (1 - k) * 3)
          const ease = open * open * (3 - 2 * open)
          mouth.current.style.transform = `translateY(${(2 * ease).toFixed(2)}px) scale(${(0.35 + 0.65 * ease).toFixed(3)}, ${(0.08 + 0.92 * ease).toFixed(3)})`
        } else {
          mouth.current.style.transform = ''
        }
      }

      if (butterfly.current) {
        if (chase === null) butterfly.current.classList.remove('on')
        else {
          const left = chase.worldX - (x - petWidth / 2) - 10
          const top = 2 + Math.sin(seconds * 2.4) * 3
          butterfly.current.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`
        }
      }
      if (zzz.current) zzz.current.classList.toggle('on', sleeping && sm > 0.7)

      if (stage.current) stage.current.style.transform = `scale(${scale}) translateY(${ART_GROUND - hop}px)`
      x = place(x, phase)
      el.dataset.gait = kind === 'busy' ? 'run' : walking ? 'walk' : 'sit'
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => {
      cancelAnimationFrame(raf)
      host.removeEventListener('pointerenter', onEnter)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
    }
  }, [])

  const pet = event => {
    event.stopPropagation()
    if (typeof onActivate === 'function') {
      onActivate()
      return
    }
    sprinkle('heart')
    hopRequest.current = { hopT: 0.5, hopH: 13 }
    wakeRequest.current = true
  }

  return h('span', {
    ref: lingchong,
    className: 'lingchong',
    style: { '--lingchong-ink-filter': `url(#${inkId}) contrast(1.05)` },
    'data-state': state,
    'data-phase': lingchongPose(state, mode, progress).phase,
    'data-gait': state === 'busy' ? 'run' : 'sit',
    role: 'button',
    tabIndex: 0,
    'aria-label': typeof onActivate === 'function' ? '打开工作详情' : '摸摸朏朏',
    onClick: pet,
    onKeyDown: event => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      pet(event)
    },
  },
  h('svg', { className: 'lingchong-ink-defs', 'aria-hidden': true, width: 0, height: 0 },
    h('filter', { id: inkId },
      h('feComponentTransfer', null, h('feFuncA', { type: 'linear', slope: 6 })))),
  h('span', { ref: flip, className: 'lingchong-flip' },
    h('span', { ref: stage, className: 'lingchong-stage' },
      h('img', { ref: tail, className: 'lingchong-art art-tail', src: standingArt, alt: '', draggable: 'false' }),
      legs.current.map((ref, index) => h('img', {
        key: `leg-${index}`,
        ref,
        className: `lingchong-art leg-${['ff', 'fn', 'bf', 'bn'][index]}`,
        src: standingArt,
        alt: '',
        draggable: 'false',
      })),
      h('img', { ref: body, className: 'lingchong-art art-body', src: standingArt, alt: '', draggable: 'false' }),
      h('svg', { ref: blink, className: 'lingchong-blink', viewBox: `0 0 ${ART_W} ${ART_H}`, 'aria-hidden': true },
        h('rect', { x: 101, y: 41, width: 36, height: 24, rx: 10, fill: '#f8f3ea' }),
        h('rect', { x: 137, y: 41, width: 36, height: 24, rx: 10, fill: '#f8f3ea' }),
        h('path', {
          d: 'M107 55 q7 4 15 -1 M143 54 q7 -4 15 1',
          fill: 'none',
          stroke: '#39332b',
          strokeWidth: 2.1,
          strokeLinecap: 'round',
        })),
      h('svg', { ref: yawn, className: 'lingchong-yawn', viewBox: `0 0 ${ART_W} ${ART_H}`, 'aria-hidden': true },
        h('g', { ref: mouth, className: 'lingchong-yawn-mouth' },
          h('path', { d: 'M116 53 q11 -5 22 0 q-1 19 -11 19 q-10 0 -11 -19z', fill: '#3e362d', stroke: '#332c22', strokeWidth: 1.3 }),
          h('path', { d: 'M120 66 q7 -9 14 0 q-7 6 -14 0z', fill: '#d98a86' }),
          h('path', { d: 'M117 53 q10 2 20 0', fill: 'none', stroke: '#f8f3ea', strokeWidth: 1.4 }))))),
  h('span', { ref: butterfly, className: 'lingchong-butterfly', 'aria-hidden': true },
    h('svg', { viewBox: '0 0 24 20' },
      h('path', { className: 'wing left', d: 'M12 10 C4 1, 1 5, 3 10 C1 15, 5 19, 12 10 Z' }),
      h('path', { className: 'wing right', d: 'M12 10 C20 1, 23 5, 21 10 C23 15, 19 19, 12 10 Z' }),
      h('path', { className: 'body', d: 'M12 4 v13' }),
      h('path', { className: 'antennae', d: 'M12 5 C10 2.5, 8.5 1.6, 6.6 2.2 M12 5 C14 2.5, 15.5 1.6, 17.4 2.2' }))),
  h('span', { ref: zzz, className: 'lingchong-zzz', 'aria-hidden': true },
    h('span', null, 'z'), h('span', null, 'z'), h('span', null, 'z')),
  h('span', { ref: sparks, className: 'spark-field', 'aria-hidden': true }))
}

export const LINGCHONG_CSS = `
.lingchong{position:absolute;top:0;left:0;z-index:7;width:112px;height:57px;--pet-scale:.2909;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;opacity:0;transform-origin:50% 100%;filter:drop-shadow(0 1px 2px rgba(60,40,0,.16))}
.lingchong:focus-visible{outline:2px solid var(--bt-accent);outline-offset:3px;border-radius:50%}
body[data-ds-dark-theme] .lingchong{filter:drop-shadow(0 1px 3px rgba(0,0,0,.42))}
.lingchong-ink-defs{position:absolute;width:0;height:0;overflow:hidden;pointer-events:none}
.lingchong-flip{position:absolute;inset:0;transform-origin:50% 50%}
.lingchong-stage{position:absolute;left:0;top:0;width:385px;height:195px;transform-origin:0 0;transform:scale(var(--pet-scale)) translateY(30px);filter:var(--lingchong-ink-filter,none)}
body[data-ds-dark-theme] .lingchong-stage{filter:var(--lingchong-ink-filter,none) invert(1) hue-rotate(180deg) brightness(1.08)}
.lingchong-art{position:absolute;inset:0;width:385px;height:195px;pointer-events:none;user-select:none}
.art-tail{clip-path:inset(0 15px 55px 288px);transform-origin:285px 95px;z-index:1}
.leg-ff{clip-path:inset(138px 242px 20px 100px);transform-origin:123px 138px;z-index:2}
.leg-fn{clip-path:inset(138px 199px 20px 143px);transform-origin:161px 138px;z-index:2}
.leg-bf{clip-path:inset(138px 133px 20px 192px);transform-origin:224px 138px;z-index:2}
.leg-bn{clip-path:inset(138px 89px 20px 252px);transform-origin:272px 138px;z-index:2}
.art-body{clip-path:inset(0 93px 55px 60px);transform-origin:195px 140px;z-index:3}
.lingchong-blink{position:absolute;inset:0;width:385px;height:195px;opacity:0;z-index:4;pointer-events:none}
.lingchong-blink.on{opacity:1}
.lingchong-yawn{position:absolute;inset:0;width:385px;height:195px;opacity:0;z-index:5;pointer-events:none}
.lingchong-yawn.on{opacity:1}
.lingchong-yawn-mouth{transform-origin:127px 58px}
.lingchong-butterfly{position:absolute;left:0;top:0;width:22px;height:18px;z-index:9;pointer-events:none;opacity:0;transition:opacity .3s var(--bt-ease);will-change:transform}
.lingchong-butterfly.on{opacity:1}
.lingchong-butterfly svg{width:100%;height:100%;overflow:visible}
.lingchong-butterfly .wing{fill:var(--bt-star,#f6c453);stroke:rgba(0,0,0,.28);stroke-width:.8;transform-origin:12px 10px;animation:lingchong-flap .18s ease-in-out infinite alternate}
.lingchong-butterfly .wing.right{animation-delay:.09s}
.lingchong-butterfly .body{stroke:var(--bt-star,#f6c453);stroke-width:1.6;stroke-linecap:round}
.lingchong-butterfly .antennae{fill:none;stroke:var(--bt-star,#f6c453);stroke-width:.9;stroke-linecap:round}
@keyframes lingchong-flap{from{transform:scaleX(.25)}to{transform:scaleX(1)}}
.lingchong-zzz{position:absolute;left:0;top:0;z-index:10;pointer-events:none;opacity:0;transition:opacity .4s var(--bt-ease)}
.lingchong-zzz.on{opacity:1}
.lingchong-zzz span{position:absolute;font:600 11px/1 var(--bt-font);color:var(--bt-ink-3);opacity:0;animation:lingchong-zzz 2.4s ease-out infinite}
.lingchong-zzz span:nth-child(1){left:44px;top:12px;font-size:10px;animation-delay:0s}
.lingchong-zzz span:nth-child(2){left:54px;top:6px;font-size:12px;animation-delay:.9s}
.lingchong-zzz span:nth-child(3){left:64px;top:0;font-size:14px;animation-delay:1.8s}
@keyframes lingchong-zzz{0%{opacity:0;transform:translate(0,4px) scale(.7)}20%{opacity:.85}100%{opacity:0;transform:translate(11px,-20px) scale(1.1)}}
.spark-field{position:absolute;inset:0;pointer-events:none;z-index:8}
.spark{position:absolute;color:var(--bt-star,#f6c453);font-size:13px;opacity:0;animation:lingchong-spark 1s ease-out forwards}
.spark[data-kind=heart]{color:#e58a9a;font-size:12px}
@keyframes lingchong-spark{0%{opacity:0;transform:translateY(3px) scale(.5)}25%{opacity:.95}100%{opacity:0;transform:translateY(-26px) scale(1.1)}}
@media (max-width:760px){.lingchong{width:88px;height:45px;--pet-scale:.2286}}
@media (prefers-reduced-motion:reduce){.spark{animation:none;opacity:0}.lingchong-butterfly .wing{animation:none}.lingchong-zzz span{animation:none;opacity:.6}}
`
