import { useEffect, useLayoutEffect, useRef } from 'react'

// Adapted from Fei2411/DS-Bot, ds-bot/src/client/motion.js (Apache-2.0).
export const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

export function springEasing(stiffness, damping) {
  const w0 = Math.sqrt(stiffness)
  const zeta = damping / (2 * w0)
  const at = t => {
    if (zeta >= 1) return 1 - (1 + w0 * t) * Math.exp(-w0 * t)
    const wd = w0 * Math.sqrt(1 - zeta * zeta)
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t))
  }
  let end = 0.05
  while (end < 2 && Math.abs(1 - at(end)) > 0.001) end += 0.01
  const points = Array.from({ length: 25 }, (_, index) => (index === 24 ? 1 : at(end * index / 24)).toFixed(4))
  return { duration: Math.round(end * 1000), easing: `linear(${points.join(',')})`, stiffness, damping }
}

export const SPRING_SHAPE = springEasing(400, 31.2)
export const spring = (curve, ...properties) => properties.map(property => `${property} ${curve.duration}ms ${curve.easing}`).join(',')

export function useMorph(box, key) {
  const last = useRef({ key, height: null, node: null, observer: null })
  useLayoutEffect(() => {
    const node = box.current
    const state = last.current
    if (node !== state.node) {
      state.observer?.disconnect()
      Object.assign(state, { key, height: null, node, observer: null })
      if (!node || typeof ResizeObserver !== 'function') return
      state.observer = new ResizeObserver(([entry]) => {
        if (node.dataset.morph === undefined) state.height = entry.borderBoxSize?.[0]?.blockSize ?? node.offsetHeight
      })
      state.observer.observe(node)
      return
    }
    if (!node || key === state.key) return
    const running = node.getAnimations().filter(animation => animation.id === 'bt-morph')
    const from = running.length ? node.offsetHeight : state.height
    for (const animation of running) animation.cancel()
    const to = node.offsetHeight
    Object.assign(state, { key, height: to })
    if (from === null || Math.abs(from - to) < 1 || reducedMotion()) return
    node.dataset.morph = ''
    const animation = node.animate([{ height: `${from}px` }, { height: `${to}px` }], {
      duration: SPRING_SHAPE.duration,
      easing: SPRING_SHAPE.easing,
      id: 'bt-morph',
    })
    animation.onfinish = () => { delete node.dataset.morph }
    animation.oncancel = () => {
      if (!node.getAnimations().some(other => other.id === 'bt-morph' && other !== animation)) delete node.dataset.morph
    }
  })
  useEffect(() => () => last.current.observer?.disconnect(), [])
}
