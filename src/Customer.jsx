import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc } from './supabase.js'
import Card from './Card.jsx'
import { nfcSupported, writeNfc } from './Scanner.jsx'

const KEY = 'fid_token'
const load = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const save = (t) => { try { localStorage.setItem(KEY, t) } catch {} }

export default function Customer({ route }) {
  const [token, setToken] = useState(() => {
    const m = route.match(/^c\/([0-9a-f-]{36})/i)
    if (m) { save(m[1]); return m[1] }
    return load()
  })
  return token ? <Wallet token={token} onReset={() => setToken(null)} /> : <Register onDone={(t) => { save(t); setToken(t) }} />
}

function Register({ onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await rpc('app_register', { p_name: name, p_phone: phone })
      onDone(r.token)
    } catch (ex) { setErr(ex.message); setBusy(false) }
  }
  return (
    <main className="shell">
      <h1 className="hero">Tu tarjeta de estrellas</h1>
      <p className="lede">Regístrate una vez. Cada visita suma una estrella y las estrellas se canjean por premios.</p>
      <form className="panel form" onSubmit={submit}>
        <label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} placeholder="Ana Pérez" /></label>
        <label>Teléfono <small>(opcional)</small><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="555 123 4567" /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Creando tarjeta…' : 'Crear mi tarjeta'}</button>
      </form>
    </main>
  )
}

function Wallet({ token, onReset }) {
  const [card, setCard] = useState(null)
  const [flipped, setFlipped] = useState(false)
  const [stamped, setStamped] = useState(false)
  const [msg, setMsg] = useState('')
  const prev = useRef(null)

  const refresh = useCallback(async () => {
    try {
      const c = await rpc('app_get_card', { p_token: token })
      if (!c) { try { localStorage.removeItem(KEY) } catch {} ; return onReset() }
      if (prev.current !== null && c.stars > prev.current) {
        setFlipped(false); setStamped(true)
        navigator.vibrate?.([60, 40, 120])
        setTimeout(() => setStamped(false), 2800)
      }
      prev.current = c.stars
      setCard(c)
    } catch {}
  }, [token, onReset])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 3000)
    const vis = () => document.visibilityState === 'visible' && refresh()
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis) }
  }, [refresh])

  if (!card) return <main className="shell"><p className="lede">Cargando tu tarjeta…</p></main>

  const next = card.promos.find((p) => p.stars_required > card.stars)
  const link = `${location.origin}${location.pathname}#/c/${token}`
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: card.business, url: link })
      else { await navigator.clipboard.writeText(link); setMsg('Enlace copiado. Ábrelo en otro dispositivo para ver tu tarjeta.') }
    } catch {}
  }
  const nfc = async () => {
    try { setMsg('Acerca una etiqueta NFC al teléfono…'); await writeNfc(card.code); setMsg('Etiqueta NFC grabada.') }
    catch { setMsg('No se pudo grabar la etiqueta NFC.') }
  }

  return (
    <main className="shell wallet" style={{ '--brand': card.color }}>
      <header className="hello">
        <span>Hola, {card.name.split(' ')[0]}</span>
        <button className="link" onClick={() => setFlipped((f) => !f)}>{flipped ? 'Ver estrellas' : 'Ver compras y QR'}</button>
      </header>

      <Card card={card} flipped={flipped} onFlip={() => setFlipped((f) => !f)} justStamped={stamped} />

      <p className="hint">
        {next ? <>Te faltan <b>{next.stars_required - card.stars}</b> para «{next.title}».</> : card.promos.length ? 'Ya puedes canjear cualquier premio.' : 'Muestra tu tarjeta en caja para sumar.'}
      </p>

      <section className="panel">
        <h2>Premios</h2>
        {card.promos.length === 0 && <p className="muted">El negocio aún no publicó premios.</p>}
        <ul className="promos">
          {card.promos.map((p) => {
            const ok = card.stars >= p.stars_required
            return (
              <li key={p.id} className={ok ? 'ok' : ''}>
                <div><b>{p.title}</b><span>{p.description}</span></div>
                <em>{ok ? 'Disponible' : `${p.stars_required} ★`}</em>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>Guardar en el teléfono</h2>
        <p className="muted">Guarda el enlace en tu pantalla de inicio (menú del navegador → «Agregar a inicio») y úsalo como llave. En caja basta con acercar el teléfono a la etiqueta NFC o mostrar el QR.</p>
        <div className="actions">
          <button className="btn" onClick={share}>Compartir enlace</button>
          {nfcSupported() && <button className="btn" onClick={nfc}>Grabar en etiqueta NFC</button>}
        </div>
        {msg && <p className="muted" role="status">{msg}</p>}
      </section>
    </main>
  )
}
