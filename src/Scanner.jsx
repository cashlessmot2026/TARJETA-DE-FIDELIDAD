import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

/** Extrae el código de tarjeta de un QR/NFC ("FID:ABCD1234", URL o texto plano). */
export function parseCode(raw) {
  const t = String(raw || '').trim()
  const m = t.match(/FID:([A-Za-z0-9]{6,12})/i)
  if (m) return m[1].toUpperCase()
  return /^[A-Za-z0-9]{8}$/.test(t) ? t.toUpperCase() : null
}

export function QrScanner({ onCode, active }) {
  const ref = useRef(null)
  const [err, setErr] = useState('')
  const cb = useRef(onCode)
  cb.current = onCode

  useEffect(() => {
    if (!active) return
    const scanner = new Html5Qrcode('qr-reader')
    let started = false
    let last = { code: '', at: 0 }
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (text) => {
          const code = parseCode(text)
          if (!code) return
          const now = Date.now()
          if (code === last.code && now - last.at < 4000) return
          last = { code, at: now }
          cb.current(code)
        },
        () => {}
      )
      .then(() => (started = true))
      .catch(() => setErr('No se pudo abrir la cámara. Revisa el permiso del navegador.'))
    return () => {
      if (started) scanner.stop().then(() => scanner.clear()).catch(() => {})
    }
  }, [active])

  return (
    <div>
      <div id="qr-reader" ref={ref} className="reader" />
      {err && <p className="err">{err}</p>}
    </div>
  )
}

export const nfcSupported = () => typeof window !== 'undefined' && 'NDEFReader' in window

export function useNfcReader(onCode, enabled) {
  const [state, setState] = useState(nfcSupported() ? 'idle' : 'unsupported')
  const cb = useRef(onCode)
  cb.current = onCode
  useEffect(() => {
    if (!enabled || !nfcSupported()) return
    const ctrl = new AbortController()
    const reader = new window.NDEFReader()
    reader
      .scan({ signal: ctrl.signal })
      .then(() => setState('listening'))
      .catch(() => setState('denied'))
    reader.onreading = (e) => {
      for (const r of e.message.records) {
        try {
          const text = new TextDecoder(r.encoding || 'utf-8').decode(r.data)
          const code = parseCode(text)
          if (code) return cb.current(code)
        } catch {}
      }
      // Etiqueta sin código nuestro: se usa su número de serie (asignado desde Clientes).
      if (e.serialNumber) return cb.current(e.serialNumber.toUpperCase())
      setState('unknown')
    }
    return () => ctrl.abort()
  }, [enabled])
  return state
}

/** Espera una etiqueta, devuelve su número de serie y (si se puede) le graba el código. */
export async function assignTag(code, signal) {
  const r = new window.NDEFReader()
  const uid = await new Promise((resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('cancelado')))
    r.onreading = (e) => resolve(e.serialNumber)
    r.onreadingerror = () => reject(new Error('No se pudo leer la etiqueta'))
    r.scan({ signal }).catch(reject)
  })
  if (!uid) throw new Error('La etiqueta no entrega número de serie')
  let written = true
  try { await new window.NDEFReader().write({ records: [{ recordType: 'text', data: `FID:${code}` }] }, { overwrite: true, signal }) }
  catch { written = false }
  return { uid: uid.toUpperCase(), written }
}

export async function writeNfc(code) {
  const w = new window.NDEFReader()
  await w.write({ records: [{ recordType: 'text', data: `FID:${code}` }] })
}
