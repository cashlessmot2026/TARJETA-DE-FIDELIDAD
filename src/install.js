// Instalación como app (PWA). El evento beforeinstallprompt puede llegar antes de que React
// monte la tarjeta, por eso se captura al importar este módulo (desde main.jsx).
import { useEffect, useState } from 'react'

let deferred = null
const subs = new Set()
const emit = () => subs.forEach((f) => f())

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; emit() })
window.addEventListener('appinstalled', () => { deferred = null; emit() })

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}))
}

const ua = navigator.userAgent
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
export const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
// Navegadores dentro de otras apps (Instagram, Facebook, WhatsApp…) no permiten instalar.
const isInApp = /FBAN|FBAV|Instagram|Line\/|WhatsApp|; wv\)/.test(ua)

// En iPhone la app instalada no comparte datos con Safari: debe abrir el enlace con el token.
// Sin manifest, Safari usa la URL actual (#/c/<token>) como inicio de la app.
export function keepTokenInUrl(token) {
  const hash = `#/c/${token}`
  if (location.hash !== hash) history.replaceState(null, '', hash)
  if (isIos) document.querySelector('link[rel="manifest"]')?.remove()
}

export function useInstall() {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((n) => n + 1)
    subs.add(f)
    const mq = window.matchMedia('(display-mode: standalone)')
    mq.addEventListener?.('change', f)
    return () => { subs.delete(f); mq.removeEventListener?.('change', f) }
  }, [])
  const installed = isStandalone()
  return {
    installed,
    platform: installed ? 'installed' : isInApp ? 'inapp' : isIos ? 'ios' : deferred ? 'prompt' : 'manual',
    prompt: async () => {
      if (!deferred) return false
      deferred.prompt()
      const { outcome } = await deferred.userChoice
      deferred = null; emit()
      return outcome === 'accepted'
    },
  }
}
