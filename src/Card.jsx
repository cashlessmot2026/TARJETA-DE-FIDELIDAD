import { QRCodeSVG } from 'qrcode.react'

const Star = ({ filled, burst }) => (
  <svg viewBox="0 0 24 24" className={`slot${filled ? ' on' : ''}${burst ? ' burst' : ''}`} aria-hidden>
    <path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z" />
  </svg>
)

const fmt = (iso) =>
  new Date(iso).toLocaleDateString('es', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '')

const spaced = (code) => (code || '').replace(/(.{4})/g, '$1 ').trim()

/** Tarjeta tipo crédito: frente = estrellas, dorso = fechas de compra + QR. */
export default function Card({ card, flipped, onFlip, justStamped }) {
  const { business, name, code, stars, goal, visits, color } = card
  const gift = (card.bonus_days || 0) > 0
  const ready = gift || !!card.can_redeem
  const slots = Math.max(goal, 1)
  const filled = Math.min(stars, slots)
  const dated = visits.filter((v) => v.delta > 0)
  return (
    <div className="scene">
      <div
        role="button"
        tabIndex={0}
        className={`card${flipped ? ' flipped' : ''}${ready ? ' ready' : ''}`}
        style={{ '--brand': color }}
        onClick={onFlip}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onFlip())}
        aria-label={flipped ? 'Ver frente de la tarjeta' : 'Ver dorso de la tarjeta'}
      >
        <span className="face front">
          <span className="sheen" />
          <span className="row top">
            <span className="biz">{card.logo && <img className="biz-logo" src={card.logo} alt="" />}{business}</span>
            <span className="chip" aria-hidden />
          </span>
          {ready ? (
            <span className="redeem">
              <span className="redeem-txt">
                <b>{gift ? '¡Ya tienes tu día gratis disponible!' : '¡Ya tienes un premio disponible!'}</b>
                <i>Canjéalo mostrando este QR en caja.</i>
              </span>
              <span className="redeem-qr">
                <QRCodeSVG value={`FID:${code}`} size={128} marginSize={3} bgColor="#FFFFFF" fgColor="#000000" level="M" />
              </span>
            </span>
          ) : (
            <>
              <span className="count">
                <b>{stars}</b>
                <i>{stars === 1 ? 'estrella' : 'estrellas'}</i>
              </span>
              <span className="slots" aria-label={`${filled} de ${slots} estrellas`}>
                {Array.from({ length: slots }, (_, i) => (
                  <Star key={i} filled={i < filled} burst={justStamped && i === filled - 1} />
                ))}
              </span>
            </>
          )}
          <span className="row bottom">
            <span className="holder">{name}</span>
            <span className="num">{spaced(code)}</span>
          </span>
          {justStamped && (
            <span className="stamp" role="status">
              <svg viewBox="0 0 120 120" aria-hidden>
                <circle cx="60" cy="60" r="46" className="ring" />
                <path d="M38 62l15 15 30-34" className="tick" />
              </svg>
              <em>+1 estrella</em>
            </span>
          )}
        </span>

        <span className="face back">
          <span className="stripe" />
          <span className="back-body">
            <span className="log">
              <b>Compras</b>
              {dated.length === 0 && <i className="empty">Aún no hay visitas. Escanea el QR de estrellas del negocio.</i>}
              {dated.slice(0, 5).map((v, i) => (
                <span key={i} className="entry">
                  <time>{fmt(v.at)}</time>
                  <span>+{v.delta}</span>
                </span>
              ))}
            </span>
            <span className="qr">
              <QRCodeSVG value={`FID:${code}`} size={128} marginSize={3} bgColor="#FFFFFF" fgColor="#000000" level="M" />
              <small>{code}</small>
            </span>
          </span>
        </span>
      </div>
    </div>
  )
}
