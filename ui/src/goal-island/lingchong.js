import { createElement as h, useEffect, useId, useRef } from 'react'
const standingArt = new URL('../assets/lingchong-line-warm.png', import.meta.url).href
const colorArt = new URL('../assets/lingchong-color.png', import.meta.url).href
const lodgeMark = new URL('../assets/lingchong-lodge-mark.png', import.meta.url).href

const WALK_SPEED = 22
const CHASE_SPEED = 52
const TROT_SPEED = 30
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
  // 岛面上沿整条都能走：留出半个身位后，从 15% 到 85%。
  const step = 0.15 + 0.7 * at
  if (state === 'busy') return { phase: 'walk', spot: mode === 'studio' ? step : 0.15 }
  if (state === 'needs') return { phase: 'sit', spot: mode === 'studio' ? step : 0.5 }
  if (state === 'done') return { phase: 'nap', spot: 0.85 }
  return { phase: 'lie', spot: mode === 'studio' ? step : 0.2 }
}

export function lingchongSpot(state, width, widthOfLingchong = 64, mode = 'chat', progress = 0) {
  const { spot } = lingchongPose(state, mode, progress)
  const half = widthOfLingchong / 2
  const min = HOME_PAD + half
  const max = Math.max(min, width - HOME_PAD - half)
  return Math.min(max, Math.max(min, width * spot))
}

export function Lingchong({ state = 'rest', mode = 'chat', progress = 0, onActivate = null }) {
  const lingchong = useRef(null)
  // 线稿缩到 64px 后笔画会被平均成半透明；用 alpha 斜率把线条压回实心墨色。
  const inkId = `lingchong-ink-${useId().replace(/:/g, '')}`
  const current = useRef({ state, mode, progress })
  current.current = { state, mode, progress }
  const flip = useRef(null)
  const stage = useRef(null)
  const tail = useRef(null)
  const body = useRef(null)
  const forehead = useRef(null)
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

  const puff = () => {
    const field = sparks.current
    if (!field) return
    const node = document.createElement('span')
    node.className = 'lingchong-puff'
    node.style.left = `${30 + Math.random() * 8}px`
    node.style.top = `${12 + Math.random() * 4}px`
    field.appendChild(node)
    setTimeout(() => node.remove(), 1700)
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
    let lastPointerClientX = null
    let pointerMovedAt = -Infinity
    let hoverX = null
    let cuddled = false
    let followUntil = -Infinity
    let wanderTarget = null
    let wanderBeat = ''
    let wanderBeatT = 0
    let nextWanderAt = 2.5 + Math.random() * 3
    let lastPuff = -Infinity
    let seconds = 0

    const place = (nextX, phase) => {
      const width = host.clientWidth
      if (width <= 0) return nextX
      const petWidth = el.offsetWidth || 64
      const petHeight = el.offsetHeight || 33
      const min = HOME_PAD + petWidth / 2
      const max = Math.max(min, width - HOME_PAD - petWidth / 2)
      const at = Math.min(max, Math.max(min, nextX))
      el.style.transform = `translate(${at - petWidth / 2}px, ${-petHeight + 1}px)`
      el.style.opacity = '1'
      if (el.dataset.phase !== phase) el.dataset.phase = phase
      return at
    }

    const targetFor = (kind, mode, progress) => lingchongSpot(kind, host.clientWidth, el.offsetWidth || 64, mode, progress)

    const endChase = () => {
      if (chase === null) return
      chase = null
      nextChaseAt = seconds + 32
      if (butterfly.current) butterfly.current.classList.remove('on')
    }
    const onEnter = event => {
      hovering = true
      pointerClientX = event.clientX
      lastPointerClientX = event.clientX
      followUntil = seconds + 3.5
      idleT = 0
      yawnT = 0
      wakeUntil = Math.max(wakeUntil, seconds + 1.5)
      endChase()
    }
    const onMove = event => {
      if (!hovering) return
      // 岛展开/收起会在光标下重排，浏览器会补发同坐标的 move；只认真实移动。
      if (lastPointerClientX === null || Math.abs(event.clientX - lastPointerClientX) > 2) {
        followUntil = seconds + 3.5
      }
      lastPointerClientX = event.clientX
      pointerClientX = event.clientX
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
      const petWidth = el.offsetWidth || 64
      const scale = petWidth / ART_W
      // 岛展开会改变自身左沿；每帧按光标重算，宠物才不会走到旧位置。
      hoverX = hovering && pointerClientX !== null
        ? pointerClientX - host.getBoundingClientRect().left
        : null
      // 光标动一次跟 3.5 秒；停住后灵宠自己接着沿边逛，不会卡在指针附近来回抖。
      const following = hovering && hoverX !== null && seconds < followUntil
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
      const resting = !done && kind === 'rest' && mode === 'chat' && !hovering && chase === null && !awake
      const sleeping = done ? !awake : resting && idleT > SLEEP_AFTER
      const snore = sleeping ? Math.sin(seconds * 1.9) : 0
      if (sleeping && snore > 0.94 && seconds - lastPuff > 1.4) { lastPuff = seconds; puff() }
      const postureTarget = done ? (awake ? 0 : 1) : (resting && idleT > 10 && wanderTarget === null ? 1 : 0)
      postureMix = Math.min(1, Math.max(0, postureMix + Math.sign(postureTarget - postureMix) * dt / 0.7))
      const sm = postureMix * postureMix * (3 - 2 * postureMix)

      // 安静时沿着整条岛上沿慢慢逛，十秒后才趴下。
      const canWander = kind === 'rest' && mode === 'chat' && !done && !following && chase === null && !sleeping && postureMix < 0.1
      if (!canWander) { wanderTarget = null; wanderBeat = ''; wanderBeatT = 0 }
      else if (wanderTarget === null && seconds > nextWanderAt) {
        const min = HOME_PAD + petWidth / 2
        const max = Math.max(min, width - HOME_PAD - petWidth / 2)
        wanderTarget = min + Math.random() * Math.max(0, max - min)
        nextWanderAt = seconds + (hovering ? 4 + Math.random() * 4 : 9 + Math.random() * 7)
      }

      // 追蝴蝶：只在聊天室安静时出现；没追上三次或玩够了就飞走。
      const canChase = kind === 'rest' && !done && !sleeping && !hovering && idleT > 6 && seconds > nextChaseAt
      if (chase === null && canChase) {
        yawnT = 0
        wanderTarget = null
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
        const cuddle = !done && following && hoverX !== null ? Math.min(max, Math.max(min, hoverX)) : null
        const target = cuddle ?? chaseTarget ?? wanderTarget ?? targetFor(kind, mode, progress)
        const delta = target - x
        if (Math.abs(delta) > 0.8) {
          direction = delta > 0 ? 1 : -1
          const speed = cuddle !== null ? 60 : chaseTarget === null ? WALK_SPEED : CHASE_SPEED
          const stepPx = Math.min(Math.abs(delta), speed * dt)
          x += direction * stepPx
          moved = stepPx
          phase = 'walk'
        } else {
          x = target
          if (wanderTarget !== null && cuddle === null && chaseTarget === null) {
            wanderTarget = null
            nextWanderAt = seconds + 2.5 + Math.random() * 2.5
            // 到站后歇一下，偶尔闻闻、看看、蹦一下或摇尾巴，再接着逛。
            if (Math.random() < 0.55) {
              const kinds = ['sniff', 'hop', 'look', 'wag']
              wanderBeat = kinds[Math.floor(Math.random() * kinds.length)]
              wanderBeatT = wanderBeat === 'hop' ? 0.6 : 1.2 + Math.random() * 0.6
              if (wanderBeat === 'hop') { hopT = 0.5; hopH = 10; happyT = 0.6 }
              if (wanderBeat === 'wag') happyT = 1.2
            }
          }
        }
        // 走到人面前就贴一下：冒爱心、尾巴摇快；离开前只贴一次。
        if (cuddle !== null && Math.abs(target - x) < 6 && !cuddled) {
          cuddled = true
          happyT = 1.2
          sprinkle('heart')
        }
      }
      if (wanderBeatT > 0) {
        wanderBeatT = Math.max(0, wanderBeatT - dt)
        if (wanderBeatT === 0) wanderBeat = ''
      }
      const walking = moved > 0.01 || kind === 'busy'
      if (walking) gait += (kind === 'busy' && moved < 0.01 ? dt * 1.6 : moved / scale / 90)
      // 自己闲逛不算“有事发生”，安静计时继续走；人凑近、追蝴蝶和干活才清零。
      if (kind === 'busy' || hoverX !== null || chaseTarget !== null) idleT = 0
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
      const breath = (walking ? 1 : sleeping ? 1 + snore * 0.04 : 1 + Math.sin(seconds * 1.85) * 0.009) + 0.02 * stretch
      const beat = wanderBeatT > 0 ? wanderBeat : ''
      const sniffLean = beat === 'sniff' ? 6 : 0
      const lookLean = beat === 'look' ? Math.sin(seconds * 2.2) * 4 : 0
      const bodyRot = (walking ? Math.sin(p) * 0.5 : 0) - 5 * sm + 2.5 * stretch + sniffLean + lookLean
      const bodyValue = `translateY(${(-bob + 6 * sm + (beat === 'sniff' ? 2 : 0) + (sleeping ? -1.6 * Math.max(0, snore) : 0)).toFixed(2)}px) rotate(${bodyRot.toFixed(2)}deg) scaleX(${(1 + 0.03 * stretch).toFixed(3)}) scaleY(${breath.toFixed(4)})`
      if (body.current) body.current.style.transform = bodyValue
      tailPhase += dt * (walking ? 5.2 : happyT > 0 ? 7 : 1.25)
      const tailAmp = beat === 'wag' ? 18 : beat === 'sniff' ? 3 : happyT > 0 ? 14 : walking ? 10 : 6
      const tailRot = Math.sin(tailPhase) * tailAmp * (1 - sm) + (-22 + Math.sin(tailPhase * 0.5) * 2) * sm + 8 * stretch
      const tailValue = `rotate(${tailRot.toFixed(2)}deg)`
      if (tail.current) tail.current.style.transform = tailValue
      if (flip.current) {
        // 线稿默认朝左；往右走才镜像，不然会倒着走。
        const dirSign = beat === 'look' ? (Math.sin(seconds * 2.2) > 0 ? -1 : 1) : direction > 0 ? -1 : 1
        flip.current.style.transform =
          // 趴下是压成一只更胖的猫：横向撑开，纵向只压一点，肚子贴着岛面。
          `scale(${(dirSign * (1 + 0.16 * sm)).toFixed(4)}, ${(1 - 0.14 * sm).toFixed(4)}) translateY(${(10.5 * sm * (petWidth / 64)).toFixed(2)}px)`
        if (forehead.current) forehead.current.style.transform = dirSign < 0 ? 'scaleX(-1)' : ''
      }

      if (yawn.current) yawn.current.classList.toggle('on', yawning || (sleeping && snore > 0.2))
      if (mouth.current) {
        if (yawning) {
          const k = 1 - yawnT / YAWN_DUR
          const open = Math.min(1, k * 4, (1 - k) * 3)
          const ease = open * open * (3 - 2 * open)
          mouth.current.style.transform = `translateY(${(2 * ease).toFixed(2)}px) scale(${(0.35 + 0.65 * ease).toFixed(3)}, ${(0.08 + 0.92 * ease).toFixed(3)})`
        } else if (sleeping) {
          const k = Math.max(0, snore)
          mouth.current.style.transform = `translateY(1px) scale(${(0.4 + 0.5 * k).toFixed(3)}, ${(0.06 + 0.5 * k).toFixed(3)})`
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
      h('span', { ref: body, className: 'lingchong-body' },
        h('img', { className: 'lingchong-art art-body', src: standingArt, alt: '', draggable: 'false' }),
        h('img', { ref: forehead, className: 'lingchong-lodge', src: lodgeMark, alt: '', draggable: 'false' }),
        h('svg', { ref: blink, className: 'lingchong-blink', viewBox: `0 0 ${ART_W} ${ART_H}`, 'aria-hidden': true },
          h('path', { d: 'M100 49 Q117 38 134 49 Q117 58 100 49 Z', fill: '#f8f3ea' }),
          h('path', { d: 'M141 49 Q158 38 175 49 Q158 58 141 49 Z', fill: '#f8f3ea' }),
          h('path', {
            d: 'M104 49 Q117 57 130 49 M145 49 Q158 57 171 49',
            fill: 'none',
            stroke: '#39332b',
            strokeWidth: 2.1,
            strokeLinecap: 'round',
          })),
        h('svg', { ref: yawn, className: 'lingchong-yawn', viewBox: `0 0 ${ART_W} ${ART_H}`, 'aria-hidden': true },
          h('g', { ref: mouth, className: 'lingchong-yawn-mouth' },
            h('path', { d: 'M130 55 q11 -5 22 0 q-1 19 -11 19 q-10 0 -11 -19z', fill: '#3e362d', stroke: '#332c22', strokeWidth: 1.3 }),
            h('path', { d: 'M134 68 q7 -9 14 0 q-7 6 -14 0z', fill: '#d98a86' }),
            h('path', { d: 'M131 55 q10 2 20 0', fill: 'none', stroke: '#f8f3ea', strokeWidth: 1.4 })))))),
  h('span', { ref: butterfly, className: 'lingchong-butterfly', 'aria-hidden': true },
    h('svg', { viewBox: '0 0 24 20' },
      h('path', { className: 'wing left', d: 'M12 10 C4 1, 1 5, 3 10 C1 15, 5 19, 12 10 Z' }),
      h('path', { className: 'wing right', d: 'M12 10 C20 1, 23 5, 21 10 C23 15, 19 19, 12 10 Z' }),
      h('path', { className: 'body', d: 'M12 4 v13' }),
      h('path', { className: 'antennae', d: 'M12 5 C10 2.5, 8.5 1.6, 6.6 2.2 M12 5 C14 2.5, 15.5 1.6, 17.4 2.2' }))),
  h('span', { ref: zzz, className: 'lingchong-zzz' },
    h('span', { 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true' })),
  h('span', { ref: sparks, className: 'spark-field', 'aria-hidden': true }))
}

export const LINGCHONG_CSS = `
.lingchong{position:absolute;top:0;left:0;z-index:7;width:64px;height:33px;--pet-scale:.1662;pointer-events:auto;cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;opacity:0;transform-origin:50% 100%;filter:drop-shadow(0 1px 2px rgba(60,40,0,.16))}
.lingchong:focus-visible{outline:2px solid var(--bt-accent);outline-offset:3px;border-radius:50%}
body[data-ds-dark-theme] .lingchong{filter:drop-shadow(0 1px 3px rgba(0,0,0,.42))}
.lingchong-ink-defs{position:absolute;width:0;height:0;overflow:hidden;pointer-events:none}
.lingchong-flip{position:absolute;inset:0;transform-origin:50% 50%}
.lingchong-stage{position:absolute;left:0;top:0;width:385px;height:195px;transform-origin:0 0;transform:scale(var(--pet-scale)) translateY(30px);filter:var(--lingchong-ink-filter,none)}
body[data-ds-dark-theme] .lingchong-stage{filter:contrast(1.03) brightness(.96) saturate(.9)}
/* 暗色底上纯白反相会变成发虚的剪影；换奶白配色，脸和身体还看得清。 */
body[data-ds-dark-theme] .lingchong-art{content:url("${colorArt}")}
.lingchong-art{position:absolute;inset:0;width:385px;height:195px;pointer-events:none;user-select:none}
.art-tail{clip-path:inset(0 15px 55px 288px);transform-origin:285px 95px;z-index:1}
.leg-ff{clip-path:inset(138px 242px 20px 100px);transform-origin:123px 138px;z-index:2}
.leg-fn{clip-path:inset(138px 199px 20px 143px);transform-origin:161px 138px;z-index:2}
.leg-bf{clip-path:inset(138px 133px 20px 192px);transform-origin:224px 138px;z-index:2}
.leg-bn{clip-path:inset(138px 89px 20px 252px);transform-origin:272px 138px;z-index:2}
.lingchong-body{position:absolute;inset:0;z-index:3;transform-origin:195px 140px;pointer-events:none}
.art-body{clip-path:inset(0 93px 55px 60px);z-index:1}
.lingchong-lodge{position:absolute;left:111px;top:16px;width:50px;height:18px;z-index:2;pointer-events:none;user-select:none;transform-origin:25px 9px}
.lingchong-blink{position:absolute;inset:0;width:385px;height:195px;opacity:0;z-index:4;pointer-events:none}
.lingchong-blink.on{opacity:1}
.lingchong-yawn{position:absolute;inset:0;width:385px;height:195px;opacity:0;z-index:5;pointer-events:none}
.lingchong-yawn.on{opacity:1}
.lingchong-yawn-mouth{transform-origin:141px 60px}
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
.lingchong-zzz span{position:absolute;font:700 18px/1 var(--bt-font);color:var(--bt-star,#f6c453);text-shadow:0 0 6px rgba(246,196,83,.45);opacity:0;animation:lingchong-zzz 3.2s ease-out infinite}
.lingchong-zzz span::before{content:'z'}
.lingchong-zzz span:nth-child(1){left:40px;top:10px;font-size:18px;animation-delay:0s}
.lingchong-zzz span:nth-child(2){left:55px;top:1px;font-size:22px;animation-delay:1.1s}
.lingchong-zzz span:nth-child(3){left:70px;top:-8px;font-size:26px;animation-delay:2.2s}
@keyframes lingchong-zzz{0%{opacity:0;transform:translate(0,5px) scale(.6)}20%{opacity:.9}100%{opacity:0;transform:translate(15px,-28px) scale(1.2)}}
.lingchong-puff{position:absolute;width:9px;height:9px;border-radius:50%;border:1px solid rgba(246,196,83,.65);background:rgba(246,196,83,.1);box-shadow:0 0 6px rgba(246,196,83,.3);opacity:0;pointer-events:none;animation:lingchong-puff 1.6s ease-out forwards}
@keyframes lingchong-puff{0%{opacity:0;transform:translate(0,0) scale(.35)}20%{opacity:.8}100%{opacity:0;transform:translate(10px,-18px) scale(1.4)}}
.spark-field{position:absolute;inset:0;pointer-events:none;z-index:8}
.spark{position:absolute;color:var(--bt-star,#f6c453);font-size:13px;opacity:0;animation:lingchong-spark 1s ease-out forwards}
.spark[data-kind=heart]{color:#e58a9a;font-size:12px}
@keyframes lingchong-spark{0%{opacity:0;transform:translateY(3px) scale(.5)}25%{opacity:.95}100%{opacity:0;transform:translateY(-26px) scale(1.1)}}
@media (max-width:760px){.lingchong{width:60px;height:31px;--pet-scale:.1558}}
@media (prefers-reduced-motion:reduce){.spark{animation:none;opacity:0}.lingchong-butterfly .wing{animation:none}.lingchong-zzz span{animation:none;opacity:.6}.lingchong-puff{animation:none;opacity:0}}
`
