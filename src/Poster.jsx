import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

const base = () => `${location.origin}${location.pathname}`
export const registerUrl = (slug) => `${base()}#/r/${slug}`
// La etiqueta NFC lleva /nfc al final para distinguirla en las estadísticas.
export const visitUrl = (slug, code, nfc = false) => `${base()}#/v/${slug}/${code}${nfc ? '/nfc' : ''}`

/** Afiche para imprimir: QR de registro, o QR de estrellas si se pasa `visit` (código de visita). */
export default function Poster({ biz, visit }) {
  const box = useRef(null)
  const url = visit ? visitUrl(biz.slug, visit) : registerUrl(biz.slug)
  const download = () => {
    const canvas = box.current?.querySelector('canvas')
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `qr-${visit ? 'estrellas' : 'registro'}-${biz.slug}.png`
    a.click()
  }
  return (
    <div className="poster-wrap">
      <div className="actions no-print">
        <button className="btn primary" onClick={() => window.print()}>Imprimir o guardar PDF</button>
        <button className="btn" onClick={download}>Descargar QR (PNG)</button>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(url)}>Copiar enlace</button>
      </div>
      <article className="poster" style={{ '--brand': biz.color }}>
        {biz.logo && <img className="poster-logo" src={biz.logo} alt="" />}
        <h2>{biz.name}</h2>
        <p className="poster-lede">{visit ? 'Escanea y suma tu estrella de hoy' : 'Escanea y obtén tu tarjeta de fidelidad'}</p>
        <div className="poster-qr" ref={box}>
          <QRCodeCanvas value={url} size={720} marginSize={2} level="M" style={{ width: '100%', height: 'auto' }} />
        </div>
        <p className="poster-steps">{visit
          ? '1. Abre tu tarjeta · 2. Toca «Sumar estrella» · 3. Escanea este código'
          : '1. Abre la cámara · 2. Escanea el código · 3. Regístrate en segundos'}</p>
        {!visit && <small className="poster-url">{url.replace(/^https?:\/\//, '')}</small>}
      </article>
    </div>
  )
}
