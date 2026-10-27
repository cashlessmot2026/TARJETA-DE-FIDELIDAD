import { useRef } from 'react'
import { QRCodeCanvas } from 'qrcode.react'

export const registerUrl = (slug) => `${location.origin}${location.pathname}#/r/${slug}`

/** Afiche para imprimir con el QR de registro del negocio. */
export default function Poster({ biz }) {
  const box = useRef(null)
  const url = registerUrl(biz.slug)
  const download = () => {
    const canvas = box.current?.querySelector('canvas')
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `qr-${biz.slug}.png`
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
        <p className="poster-lede">Escanea y obtén tu tarjeta de fidelidad</p>
        <div className="poster-qr" ref={box}>
          <QRCodeCanvas value={url} size={720} marginSize={2} level="M" style={{ width: '100%', height: 'auto' }} />
        </div>
        <p className="poster-steps">1. Abre la cámara · 2. Escanea el código · 3. Regístrate en segundos</p>
        <small className="poster-url">{url.replace(/^https?:\/\//, '')}</small>
      </article>
    </div>
  )
}
