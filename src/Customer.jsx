import Fireworks from './Fireworks.jsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc, supabase } from './supabase.js'
import Card from './Card.jsx'
import { nfcSupported, writeNfc } from './Scanner.jsx'
import { keepTokenInUrl, useInstall } from './install.js'

const KEY = 'fid_token'
const load = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const save = (t) => { try { localStorage.setItem(KEY, t) } catch {} }

export default function Customer({ route }) {
  const [token, setToken] = useState(() => {
    const m = route.match(/^c\/([0-9a-f-]{36})/i)
    if (m) { save(m[1]); return m[1] }
    return load()
  })
  const [fresh, setFresh] = useState(false)
  return token
    ? <Wallet token={token} fresh={fresh} onReset={() => setToken(null)} />
    : <Register onDone={(t) => { save(t); setFresh(true); setToken(t) }} />
}

function Register({ onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [plans, setPlans] = useState([])
  const [plan, setPlan] = useState(null)
  useEffect(() => {
    rpc('app_plans').then((p) => { setPlans(p || []); if (p?.length) setPlan(p[0].id) }).catch(() => {})
  }, [])
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await rpc('app_register', { p_name: name, p_phone: phone, p_plan: plan })
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
        {plans.length > 0 && (
          <fieldset className="plans">
            <legend>Elige tu plan</legend>
            {plans.map((p) => (
              <label key={p.id} className={`plan${plan === p.id ? ' on' : ''}`}>
                <input type="radio" name="plan" checked={plan === p.id} onChange={() => setPlan(p.id)} />
                <span><b>{p.title}</b><small>{p.description || `${p.stars_required} días pagados`} · {p.reward_days} {p.reward_days === 1 ? 'día' : 'días'} de regalo</small></span>
              </label>
            ))}
          </fieldset>
        )}
        {err && <p className="err">{err}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Creando tarjeta…' : 'Crear mi tarjeta'}</button>
      </form>
    </main>
  )
}

function Wallet({ token, fresh, onReset }) {
  const install = useInstall()
  const [showInstall, setShowInstall] = useState(fresh)
  const [card, setCard] = useState(null)
  const [flipped, setFlipped] = useState(false)
  const [stamped, setStamped] = useState(false)
  const [msg, setMsg] = useState('')
  const [skipUp, setSkipUp] = useState(false)
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
      if (prev.current !== null && c.stars !== prev.current) {
        supabase.functions.invoke('wallet-pass', { body: { token, action: 'sync' } }).catch(() => {})
      }
      prev.current = c.stars
      setCard(c)
    } catch {}
  }, [token, onReset])

  useEffect(() => keepTokenInUrl(token), [token])

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
  const gwallet = async () => {
    setMsg('Preparando tu tarjeta…')
    const { data, error } = await supabase.functions.invoke('wallet-pass', { body: { token, action: 'save' } })
    if (error || !data?.url) return setMsg('Google Wallet aún no está disponible. Usa el enlace por ahora.')
    window.location.href = data.url
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

      <Fireworks show={stamped} />
      <Card card={card} flipped={flipped} onFlip={() => setFlipped((f) => !f)} justStamped={stamped} />

      <p className="hint">
        {card.bonus_days > 0 ? '¡Tienes un día gratis! Muestra el QR para redimirlo; al usarlo tu tarjeta se cierra.' : next ? <>Te faltan <b>{next.stars_required - card.stars}</b> para «{next.title}».</> : card.promos.length ? 'Ya puedes canjear cualquier premio.' : 'Muestra tu tarjeta en caja para sumar.'}
      </p>

      {card.can_upgrade && card.next_plan && !skipUp && (
        <section className="panel upgrade">
          <h2>¡Completaste tu plan de {card.plan.days} días!</h2>
          <p className="muted">¿Quieres seguir con el plan de <b>{card.next_plan.days} días</b>? Al completarlo recibes {card.next_plan.reward_days} {card.next_plan.reward_days === 1 ? 'día' : 'días'} de regalo en total.</p>
          <div className="actions">
            <button className="btn primary" onClick={async () => { try { await rpc('app_choose_plan', { p_token: token, p_plan: card.next_plan.id }); refresh() } catch (e) { setMsg(e.message) } }}>Sí, pasar al plan de {card.next_plan.days} días</button>
            <button className="btn" onClick={() => setSkipUp(true)}>No, repetir {card.plan.days} días</button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Días de regalo</h2>
        <p className="muted">Cada día pagado suma una estrella. Tu plan: {card.plan?.title} — al completar {card.plan?.days} días recibes {card.plan?.reward_days} de regalo.</p>
        <p><b>{card.bonus_days || 0}</b> {card.bonus_days === 1 ? 'día disponible' : 'días disponibles'}</p>
      </section>

      <section className="panel">
        <h2>Premios</h2>
        {card.promos.length === 0 && <p className="muted">El negocio aún no publicó premios.</p>}
        <ul className="promos">
          {card.promos.map((p) => {
            const ok = card.stars >= p.stars_required
            return (
              <li key={p.id} className={ok ? 'ok' : ''}>
                <div><b>{p.title}</b><span>{p.description}</span></div>
                <em>{`${p.stars_required} días · +${p.reward_days} gratis`}</em>
              </li>
            )
          })}
        </ul>
      </section>

      <section className="panel">
        <h2>Guardar en el teléfono</h2>
        <p className="muted">Instala tu tarjeta como app para abrirla con un toque. En caja basta con acercar el teléfono a la etiqueta NFC o mostrar el QR.</p>
        <div className="actions">
          {!install.installed && <button className="btn primary" onClick={() => setShowInstall(true)}>Instalar como app</button>}
          <button className={`btn${install.installed ? ' primary' : ''}`} onClick={gwallet}>Agregar a Google Wallet</button>
          <button className="btn" onClick={share}>Compartir enlace</button>
          {nfcSupported() && <button className="btn" onClick={nfc}>Grabar en etiqueta NFC</button>}
        </div>
        {msg && <p className="muted" role="status">{msg}</p>}
      </section>

      {showInstall && !install.installed && <InstallSheet install={install} welcome={fresh} onClose={() => setShowInstall(false)} />}
    </main>
  )
}

function InstallSheet({ install, welcome, onClose }) {
  const steps = {
    ios: <ol><li>Toca el botón <b>Compartir</b> <span aria-hidden>⬆️</span> en la barra de Safari.</li><li>Elige <b>«Agregar a inicio»</b>.</li><li>Toca <b>Agregar</b>. Tu tarjeta quedará como app en tu pantalla.</li></ol>,
    inapp: <ol><li>Toca el menú <b>⋮</b> o <b>…</b> de esta pantalla.</li><li>Elige <b>«Abrir en Chrome»</b> o <b>«Abrir en el navegador»</b>.</li><li>Ahí podrás instalar tu tarjeta como app.</li></ol>,
    manual: <ol><li>Toca el menú <b>⋮</b> del navegador.</li><li>Elige <b>«Instalar aplicación»</b> o <b>«Agregar a pantalla de inicio»</b>.</li></ol>,
  }
  const go = async () => { if (await install.prompt()) onClose() }
  return (
    <div className="sheet-bg" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="install-title" onClick={(e) => e.stopPropagation()}>
        <img src="./icon-192.png" alt="" width="64" height="64" />
        <h2 id="install-title">{welcome ? '¡Tu tarjeta está lista!' : 'Instala tu tarjeta'}</h2>
        <p className="muted">Descárgala como app para tenerla siempre a mano, sin buscar el enlace.</p>
        {install.platform === 'prompt'
          ? <button className="btn primary" onClick={go}>Descargar app</button>
          : steps[install.platform]}
        <button className="link" onClick={onClose}>Ahora no</button>
      </section>
    </div>
  )
}
