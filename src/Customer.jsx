import Fireworks from './Fireworks.jsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc, supabase } from './supabase.js'
import Card from './Card.jsx'
import { nfcSupported, writeNfc } from './Scanner.jsx'
import { keepTokenInUrl, useInstall } from './install.js'
import { cardForBiz, loadCards, removeCard, saveCard } from './cards.js'

const go = (hash) => location.replace(hash)
const infos = new Map() // datos públicos (y logo) de cada negocio, se piden una sola vez
const bizInfo = (slug) => {
  if (!infos.has(slug)) infos.set(slug, rpc('app_business', { p_slug: slug }).catch(() => null))
  return infos.get(slug)
}

// Rutas del cliente: #/r/<negocio> registro · #/c/<token> tarjeta · #/ mis tarjetas
export default function Customer({ route }) {
  const [fresh, setFresh] = useState(false)
  const c = route.match(/^c\/([0-9a-f-]{36})/i)
  if (c) return <Wallet key={c[1]} token={c[1]} fresh={fresh} onReset={() => { removeCard(c[1]); go('#/') }} />
  const r = route.match(/^r\/([a-z0-9-]+)/i)
  if (r) {
    const slug = r[1].toLowerCase()
    const had = cardForBiz(slug)
    if (had) return <Redirect to={`#/c/${had.token}`} />
    return <Register biz={slug} onDone={(t) => { saveCard(t, slug); setFresh(true); go(`#/c/${t}`) }} />
  }
  return <MyCards />
}

function Redirect({ to }) {
  useEffect(() => go(to), [to])
  return null
}

function MyCards() {
  const [list, setList] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    const saved = loadCards()
    if (saved.length === 0) return setList([])
    rpc('app_cards', { p_tokens: saved.map((x) => x.token) })
      .then((cs) => {
        const alive = new Set(cs.map((x) => x.token))
        saved.forEach((x) => !alive.has(x.token) && removeCard(x.token))
        cs.forEach((x) => saveCard(x.token, x.biz))
        if (cs.length === 1) go(`#/c/${cs[0].token}`)
        else setList(cs)
      })
      .catch(() => setErr(true))
  }, [])
  if (err) return <main className="shell"><p className="lede">No se pudieron cargar tus tarjetas. Revisa tu conexión.</p></main>
  if (!list) return <main className="shell"><p className="lede">Cargando tus tarjetas…</p></main>
  if (list.length === 0) return (
    <main className="shell narrow">
      <h1 className="hero">Tu tarjeta de fidelidad</h1>
      <p className="lede">Escanea el código QR del negocio para obtener tu tarjeta y empezar a sumar estrellas.</p>
    </main>
  )
  return (
    <main className="shell">
      <h1 className="hero sm">Mis tarjetas</h1>
      <ul className="mycards">
        {list.map((x) => (
          <li key={x.token}>
            <a href={`#/c/${x.token}`} className="minicard" style={{ '--brand': x.color }}>
              {x.logo ? <img src={x.logo} alt="" /> : <span className="ph" aria-hidden>★</span>}
              <span><b>{x.business}</b><small>{x.name}</small></span>
              <em>{x.bonus_days > 0 ? '🎁 regalo' : `${Math.min(x.stars, x.goal)}/${x.goal} ★`}</em>
            </a>
          </li>
        ))}
      </ul>
    </main>
  )
}

function Register({ biz, onDone }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState(undefined)
  const [plan, setPlan] = useState(null)
  const plans = info?.plans || []
  useEffect(() => {
    bizInfo(biz).then((b) => { setInfo(b); if (b?.plans?.length) setPlan(b.plans[0].id) })
  }, [biz])
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await rpc('app_register', { p_biz: biz, p_name: name, p_phone: phone, p_plan: plan })
      onDone(r.token)
    } catch (ex) { setErr(ex.message); setBusy(false) }
  }
  if (info === undefined) return <main className="shell"><p className="lede">Cargando…</p></main>
  if (!info) return (
    <main className="shell narrow">
      <h1 className="hero sm">Negocio no disponible</h1>
      <p className="lede">Este código QR no está activo. Pide al negocio un código nuevo.</p>
    </main>
  )
  return (
    <main className="shell" style={{ '--brand': info.color }}>
      {info.logo && <img className="reg-logo" src={info.logo} alt={info.name} />}
      <h1 className="hero">Tu tarjeta de {info.name}</h1>
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
  const [logo, setLogo] = useState(null)
  const many = loadCards().length > 1
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
      if (!c) return onReset()
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
      if (c.biz) saveCard(token, c.biz)
    } catch {}
  }, [token, onReset])

  useEffect(() => keepTokenInUrl(token), [token])
  useEffect(() => { if (card?.biz) bizInfo(card.biz).then((b) => setLogo(b?.logo || null)) }, [card?.biz])

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
        <span>{many && <><a className="link" href="#/">‹ Mis tarjetas</a> · </>}Hola, {card.name.split(' ')[0]}</span>
        <button className="link" onClick={() => setFlipped((f) => !f)}>{flipped ? 'Ver estrellas' : 'Ver compras y QR'}</button>
      </header>

      <Fireworks show={stamped} />
      <Card card={{ ...card, logo }} flipped={flipped} onFlip={() => setFlipped((f) => !f)} justStamped={stamped} />

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

      {card.rewards?.length > 0 && (
        <section className="panel">
          <h2>Premios</h2>
          <ul className="promos">
            {card.rewards.map((r) => (
              <li key={r.id} className={r.stars_required && card.stars >= r.stars_required ? 'ok' : ''}>
                <div><b>{r.title}</b><span>{r.description}</span></div>
                {r.stars_required && <em>{Math.min(card.stars, r.stars_required)}/{r.stars_required} ★</em>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="panel">
        <h2>Guardar en el teléfono</h2>
        <p className="muted">Instala tu tarjeta como app para abrirla con un toque. En caja basta con acercar el teléfono a la etiqueta NFC o mostrar el QR.</p>
        <div className="actions">
          {!install.installed && <button className="btn primary" onClick={() => setShowInstall(true)}>Instalar como app</button>}
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
