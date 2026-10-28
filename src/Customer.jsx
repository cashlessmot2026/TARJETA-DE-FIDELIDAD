import Fireworks from './Fireworks.jsx'
import { useCallback, useEffect, useRef, useState } from 'react'
import { rpc, supabase } from './supabase.js'
import Card from './Card.jsx'
import { QrScanner, parseVisit, useNfcText } from './Scanner.jsx'
import { isIos, keepTokenInUrl, useInstall } from './install.js'
import { cardForBiz, loadCards, removeCard, saveCard } from './cards.js'

const go = (hash) => location.replace(hash)
// Voz del navegador. En iPhone solo suena si antes hubo un toque: unlockVoice() se llama al abrir «Sumar estrella».
const say = (text) => {
  try {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'es-CO'
    u.voice = speechSynthesis.getVoices().find((v) => v.lang.startsWith('es')) || null
    speechSynthesis.cancel(); speechSynthesis.speak(u)
  } catch {}
}
const unlockVoice = () => { try { speechSynthesis.speak(new SpeechSynthesisUtterance('')) } catch {} }
const thanks = () => { navigator.vibrate?.([60, 40, 120]); say('¡Gracias por tu compra!') }
const infos = new Map() // datos públicos (y logo) de cada negocio, se piden una sola vez
const bizInfo = (slug) => {
  if (!infos.has(slug)) infos.set(slug, rpc('app_business', { p_slug: slug }).catch(() => null))
  return infos.get(slug)
}

// Rutas del cliente: #/r/<negocio> registro · #/c/<token> tarjeta · #/v/<negocio>/<código> sumar estrella · #/ mis tarjetas
export default function Customer({ route }) {
  const [fresh, setFresh] = useState(false)
  const v = route.match(/^v\/([a-z0-9-]+)\/([A-Za-z0-9]{6,16})(\/nfc)?/i)
  if (v) return <Checkin key={route} biz={v[1].toLowerCase()} code={v[2].toUpperCase()} via={v[3] ? 'nfc' : 'qr'} />
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
      <ScanButton />
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
      <p className="lede">Regístrate una vez. En cada visita escanea el QR de estrellas del negocio y suma una estrella.</p>
      <form className="panel form" onSubmit={submit}>
        <label>Nombre<input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} placeholder="Ana Pérez" /></label>
        <label>Teléfono <small>(lo usas para sumar estrellas si no abres la app)</small><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" required minLength={7} placeholder="300 123 4567" /></label>
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

  return (
    <main className="shell wallet" style={{ '--brand': card.color }}>
      <header className="hello">
        <span>{many && <><a className="link" href="#/">‹ Mis tarjetas</a> · </>}Hola, {card.name.split(' ')[0]}</span>
        <button className="link" onClick={() => setFlipped((f) => !f)}>{flipped ? 'Ver estrellas' : 'Ver compras y QR'}</button>
      </header>

      <Fireworks show={stamped} />
      <Card card={{ ...card, logo }} flipped={flipped} onFlip={() => setFlipped((f) => !f)} justStamped={stamped} />

      <ScanButton />

      <p className="hint">
        {card.bonus_days > 0 ? '¡Tienes un día gratis! Muestra el QR para redimirlo; al usarlo tu tarjeta se cierra.' : next ? <>Te faltan <b>{next.stars_required - card.stars}</b> para «{next.title}».</> : card.promos.length ? 'Ya puedes canjear cualquier premio.' : 'Escanea el QR de estrellas del negocio para sumar.'}
      </p>

      {card.has_phone === false && <PhoneAsk token={token} onDone={refresh} />}

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
        <p className="muted">Instala tu tarjeta como app para abrirla con un toque. En el negocio toca «Sumar estrella» y escanea su QR, o acerca el teléfono a su etiqueta NFC.</p>
        <div className="actions">
          {!install.installed && <button className="btn primary" onClick={() => setShowInstall(true)}>Instalar como app</button>}
          <button className="btn" onClick={share}>Compartir enlace</button>
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

// Lee el QR de estrellas (cámara) o la etiqueta NFC del negocio y lleva a #/v/<negocio>/<código>.
function ScanButton() {
  const [open, setOpen] = useState(false)
  const [bad, setBad] = useState(false)
  const close = () => { setOpen(false); setBad(false) }
  const nfc = useNfcText((t) => { const r = parseVisit(t); if (r) go(`#/${r}/nfc`); else setBad(true) }, open)
  return (
    <>
      <button className="btn primary big" onClick={() => { unlockVoice(); setOpen(true) }}>★ Sumar estrella</button>
      {open && (
        <div className="sheet-bg" onClick={close}>
          <section className="sheet" role="dialog" aria-modal="true" aria-labelledby="scan-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="scan-title">Sumar estrella</h2>
            <p className="muted">Apunta la cámara al QR de estrellas del negocio{nfc === 'listening' ? ' o acerca la parte de atrás del teléfono a su etiqueta NFC' : ''}.</p>
            <div className="full">
              <QrScanner active parse={(t) => parseVisit(t) || (setBad(true), null)} onCode={(r) => go(`#/${r}`)} />
            </div>
            {nfc === 'listening' && <p className="nfc-live"><span className="dot" aria-hidden /> NFC activo: acerca el teléfono a la etiqueta</p>}
            {nfc === 'empty' && <p className="err">Esa etiqueta NFC está vacía o no tiene el enlace de estrellas. Pide al negocio que la grabe de nuevo, o escanea el QR.</p>}
            {nfc === 'error' && <p className="err">No se pudo leer la etiqueta. Mantén el teléfono quieto sobre ella un segundo.</p>}
            {nfc === 'denied' &&<p className="muted">Para usar la etiqueta NFC, permite «Dispositivos NFC» en los ajustes del sitio, o escanea el QR.</p>}
            {nfc === 'unsupported' && <p className="muted">{isIos
              ? 'Con etiqueta NFC: cierra esta ventana y acerca la parte de arriba del iPhone a la etiqueta; toca el aviso que aparece.'
              : 'Con etiqueta NFC: activa el NFC del teléfono y acércalo a la etiqueta; se abrirá solo.'}</p>}
            {bad && <p className="err">Ese no es un código de estrellas. Busca el QR que dice «Escanea y suma tu estrella».</p>}
            <button className="link" onClick={close}>Cancelar</button>
          </section>
        </div>
      )}
    </>
  )
}

function PhoneAsk({ token, onDone }) {
  const [phone, setPhone] = useState('')
  const [err, setErr] = useState('')
  const save = async (e) => {
    e.preventDefault()
    try { await rpc('app_set_phone', { p_token: token, p_phone: phone }); onDone() }
    catch (x) { setErr(x.message) }
  }
  return (
    <form className="panel form" onSubmit={save}>
      <h2>Agrega tu teléfono</h2>
      <p className="muted">Lo necesitas para sumar estrellas cuando escaneas el código fuera de la app.</p>
      <label>Teléfono<input type="tel" inputMode="tel" autoComplete="tel" required minLength={7} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="300 123 4567" /></label>
      {err && <p className="err">{err}</p>}
      <button className="btn primary">Guardar</button>
    </form>
  )
}

// #/v/<negocio>/<código>: suma la estrella con la tarjeta guardada en este navegador o, si no la hay, con el teléfono.
function Checkin({ biz, code, via }) {
  const [info, setInfo] = useState(undefined)
  const [st, setSt] = useState({ step: 'loading' })
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const ran = useRef(false)
  useEffect(() => { bizInfo(biz).then(setInfo) }, [biz])
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    const card = cardForBiz(biz)
    if (!card) return setSt({ step: 'phone' })
    rpc('app_checkin', { p_token: card.token, p_biz: biz, p_code: code, p_via: via })
      .then((r) => {
        if (!r) { removeCard(card.token); return setSt({ step: 'phone' }) }
        thanks()
        setSt({ step: 'done', r, token: card.token })
      })
      .catch((e) => setSt({ step: 'error', msg: e.message, token: card.token }))
  }, [biz, code, via])

  const byPhone = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const r = await rpc('app_checkin_phone', { p_biz: biz, p_code: code, p_phone: phone, p_via: via })
      if (!r) setSt({ step: 'nocard' })
      else { thanks(); setSt({ step: 'done', r }) }
    } catch (x) { setSt({ step: 'phone', msg: x.message }) }
    setBusy(false)
  }

  const name = info?.name || 'el negocio'
  const open = st.token && <a className="btn primary" href={`#/c/${st.token}`}>Ver mi tarjeta</a>
  return (
    <main className="shell" style={info?.color ? { '--brand': info.color } : undefined}>
      {info?.logo && <img className="reg-logo" src={info.logo} alt={info.name} />}
      {st.step === 'loading' && <p className="lede">Sumando tu estrella…</p>}
      {st.step === 'phone' && (
        <>
          <h1 className="hero sm">Suma tu estrella en {name}</h1>
          <form className="panel form" onSubmit={byPhone}>
            <p className="muted">Escribe el teléfono con el que te registraste.</p>
            <label>Teléfono<input type="tel" inputMode="tel" autoComplete="tel" autoFocus required minLength={7} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="300 123 4567" /></label>
            {st.msg && <p className="err">{st.msg}</p>}
            <button className="btn primary" disabled={busy}>{busy ? 'Sumando…' : 'Sumar estrella'}</button>
          </form>
        </>
      )}
      {st.step === 'nocard' && (
        <section className="panel">
          <h2>No encontramos tu tarjeta</h2>
          <p className="muted">No hay una tarjeta con ese teléfono en {name}.</p>
          <div className="actions">
            <a className="btn primary" href={`#/r/${biz}`}>Crear mi tarjeta</a>
            <button className="btn" onClick={() => setSt({ step: 'phone' })}>Probar otro número</button>
          </div>
        </section>
      )}
      {st.step === 'done' && (
        <>
          <Fireworks show />
          <div className="result good" role="status">
            <svg viewBox="0 0 120 120" aria-hidden><circle cx="60" cy="60" r="46" className="ring" /><path d="M38 62l15 15 30-34" className="tick" /></svg>
            <div>
              <b>¡+1 estrella, {st.r.name.split(' ')[0]}!</b>
              <span>Visita {st.r.day} de {st.r.target}{st.r.gift ? ` · ¡ganaste ${st.r.gift} de regalo!` : ''}</span>
              {st.r.bonus_days > 0 && <span>Tienes {st.r.bonus_days} de regalo disponible{st.r.bonus_days === 1 ? '' : 's'}.</span>}
            </div>
          </div>
          {open || <p className="muted">Abre tu tarjeta desde la app para verla.</p>}
        </>
      )}
      {st.step === 'error' && (
        <>
          <div className="result bad" role="alert"><div><b>No se sumó la estrella</b><span>{st.msg}</span></div></div>
          {open}
        </>
      )}
    </main>
  )
}
