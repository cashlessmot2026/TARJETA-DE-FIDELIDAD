import { useEffect, useRef } from 'react'

const COLORS = ['#5CE1B0', '#F5C451', '#FF6B8B', '#7AB8FF', '#FFFFFF', '#C79BFF']

/** Juegos pirotécnicos a pantalla completa. Se muestra mientras `show` sea true. */
export default function Fireworks({ show, duration = 3200 }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!show) return
    const cv = ref.current
    if (!cv || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const ctx = cv.getContext('2d')
    const dpr = window.devicePixelRatio || 1
    const W = (cv.width = innerWidth * dpr), H = (cv.height = innerHeight * dpr)
    let parts = [], raf, start = performance.now(), last = start, nextBurst = 0
    const burst = () => {
      const x = (0.15 + Math.random() * 0.7) * W, y = (0.12 + Math.random() * 0.4) * H
      const c = COLORS[(Math.random() * COLORS.length) | 0], n = 46
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, sp = (1.5 + Math.random() * 3.2) * dpr
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, c, r: (1.2 + Math.random() * 1.6) * dpr })
      }
    }
    const tick = (t) => {
      const dt = Math.min((t - last) / 16.7, 3); last = t
      if (t - start < duration - 900 && t >= nextBurst) { burst(); nextBurst = t + 260 + Math.random() * 280 }
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, 0, W, H)
      ctx.globalCompositeOperation = 'lighter'
      parts = parts.filter((p) => p.life > 0)
      for (const p of parts) {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 0.045 * dpr * dt; p.vx *= 0.985; p.life -= 0.013 * dt
        ctx.globalAlpha = Math.max(p.life, 0); ctx.fillStyle = p.c
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill()
      }
      if (t - start < duration) raf = requestAnimationFrame(tick)
      else ctx.clearRect(0, 0, W, H)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H) }
  }, [show, duration])
  if (!show) return null
  return <canvas ref={ref} aria-hidden style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 60 }} />
}
