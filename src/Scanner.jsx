import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

/** Extrae el código de tarjeta de un QR ("FID:ABCD1234" o texto plano). */
export function parseCode(raw) {
  const t = String(raw || '').trim()
  const m = t.match(/FID:([A-Za-z0-9]{6,12})/i)
  if (m) return m[1].toUpperCase()
  return /^[A-Za-z0-9]{8}$/.test(t) ? t.toUpperCase() : null
}

/** Extrae la ruta de visita de un QR o etiqueta del negocio (".../#/v/<negocio>/<código>"). */
export function parseVisit(raw) {
  const m = String(raw || '').match(/#\/v\/([a-z0-9-]+)\/([A-Za-z0-9]{6,16})/i)
  return m ? `v/${m[1].toLowerCase()}/${m[2].toUpperCase()}` : null
}

export function QrScanner({ onCode, active, parse = parseCode }) {
  const ref = useRef(null)
  const [err, setErr] = useState('')
  const cb = useRef(onCode)
  cb.current = onCode
  const pr = useRef(parse)
  pr.current = parse

  useEffect(() => {
    if (!active) return
    const scanner = new Html5Qrcode('qr-reader', { useBarCodeDetectorIfSupported: true, verbose: false })
    let started = false
    let last = { code: '', at: 0 }
    scanner
      .start(
        { facingMode: 'environment' },
        { fps: 15, aspectRatio: 1, disableFlip: false },
        (text) => {
          const code = pr.current(text)
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

/** Graba un enlace en una etiqueta NFC (Chrome para Android). */
export async function writeNfcUrl(url) {
  const w = new window.NDEFReader()
  await w.write({ records: [{ recordType: 'url', data: url }] }, { overwrite: true })
}
