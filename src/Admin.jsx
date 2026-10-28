import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { QrScanner, parseCode, nfcSupported, writeNfcUrl } from './Scanner.jsx'
import Poster, { visitUrl } from './Poster.jsx'

// Sesión del admin: { p_biz, p_pin, biz } — p_biz es el enlace del negocio (#/admin/<negocio>).
const KEY = 'fid_admin'
const getSession = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) } catch { return null } }
const when = (iso) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Admin({ slug }) {
  const [sess, setSess] = useState(() => { const s = getSession(); return s && (!slug || s.p_biz === slug) ? s : null })
  if (!sess) return <Gate slug={slug} onOk={(s) => { try { sessionStorage.setItem(KEY, JSON.stringify(s)) } catch {} ; setSess(s) }} />
  const { biz, ...auth } = sess
  return <Dash pin={auth} biz={biz} onExit={() => { try { sessionStorage.removeItem(KEY) } catch {} ; setSess(null) }} />
}

function Gate({ slug, onOk }) {
  const [b, setB] = useState(slug || '')
  const [v, setV] = useState('')
  const [err, setErr] = useState('')
  const go = async (e) => {
    e.preventDefault()
    const auth = { p_biz: b.trim().toLowerCase(), p_pin: v }
    try { onOk({ ...auth, biz: await rpc('admin_check', auth) }) }
    catch (x) { setErr(x.message) }
  }
  return (
    <main className="shell narrow">
      <h1 className="hero sm">Acceso del negocio</h1>
      <form className="panel form" onSubmit={go}>
        {!slug && <label>Enlace del negocio<input value={b} onChange={(e) => setB(e.target.value)} placeholder="panaderia-la-espiga" autoCapitalize="none" required /></label>}
        <label>PIN<input type="password" inputMode="numeric" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary">Entrar</button>
      </form>
    </main>
  )
}

const TABS = [['panel', 'Panel'], ['estrellas', 'QR de estrellas'], ['clientes', 'Clientes'], ['promos', 'Planes'], ['premios', 'Premios'], ['validar', 'Redimir'], ['qr', 'QR de registro'], ['ajustes', 'Ajustes']]

function Dash({ pin, biz, onExit }) {
  const [tab, setTab] = useState('panel')
  return (
    <div className="admin">
      <nav className="side" aria-label="Administración">
        <div className="logo">{biz.logo ? <img src={biz.logo} alt="" /> : <svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z" /></svg>}{biz.name}</div>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        <button className="exit" onClick={onExit}>Salir</button>
      </nav>
      <section className="content">
        {tab === 'panel' && <Panel pin={pin} />}
        {tab === 'estrellas' && <Estrellas pin={pin} biz={biz} />}
        {tab === 'clientes' && <Clientes pin={pin} />}
        {tab === 'promos' && <Promos pin={pin} />}
        {tab === 'premios' && <Premios pin={pin} />}
        {tab === 'validar' && <Validar pin={pin} />}
        {tab === 'qr' && <><h1 className="h1 no-print">Código QR de registro</h1><p className="muted no-print">Imprime este afiche y ponlo en tu local. Tus clientes lo escanean para crear su tarjeta.</p><Poster biz={biz} /></>}
        {tab === 'ajustes' && <Ajustes pin={pin} />}
      </section>
    </div>
  )
}

function useRpc(fn, pin) {
  const [data, set] = useState(null)
  const [err, setErr] = useState('')
  const reload = useCallback(() => rpc(fn, pin).then(set).catch((e) => setErr(e.message)), [fn, pin])
  useEffect(() => { reload() }, [reload])
  return [data, reload, err]
}

function Panel({ pin }) {
  const [d, , err] = useRpc('admin_overview', pin)
  if (err) return <p className="err">{err}</p>
  if (!d) return <p className="muted">Cargando…</p>
  const max = Math.max(1, ...d.series.map((s) => s.n))
  const W = 560, H = 140, bw = W / d.series.length
  return (
    <>
      <h1 className="h1">Panel de {d.business}</h1>
      <div className="stats">
        <div><b>{d.customers}</b><span>clientes registrados</span></div>
        <div><b>{d.today}</b><span>estrellas hoy</span></div>
        <div><b>{d.stars_total}</b><span>estrellas entregadas</span></div>
        <div><b>{d.redeemed}</b><span>premios canjeados</span></div>
      </div>
      <div className="panel">
        <h2>Estrellas por día, últimos 14 días</h2>
        <svg viewBox={`0 0 ${W} ${H + 24}`} className="chart" role="img" aria-label="Estrellas entregadas por día">
          {d.series.map((s, i) => {
            const h = (s.n / max) * H
            return (
              <g key={s.day}>
                <rect x={i * bw + 6} y={H - h} width={bw - 12} height={Math.max(h, 2)} rx="4" className={s.n ? 'bar' : 'bar zero'} />
                {s.n > 0 && <text x={i * bw + bw / 2} y={H - h - 5} textAnchor="middle" className="val">{s.n}</text>}
                <text x={i * bw + bw / 2} y={H + 16} textAnchor="middle" className="ax">{s.day.slice(8)}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="panel">
        <h2>Actividad reciente</h2>
        {d.recent.length === 0 && <p className="muted">Todavía no hay movimientos.</p>}
        <ul className="feed">
          {d.recent.map((r, i) => (
            <li key={i}><span>{r.name}</span><span className={r.delta > 0 ? 'plus' : 'minus'}>{r.delta > 0 ? '+' : ''}{r.delta} ★</span><time>{when(r.at)}</time></li>
          ))}
        </ul>
      </div>
    </>
  )
}

function Clientes({ pin }) {
  const [list, reload, err] = useRpc('admin_customers', pin)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(null)
  // «+» suma un día con la lógica del plan (sin la pausa de 5 min); «−» solo quita una estrella.
  const adj = async (c, delta) => {
    setBusy(c.id)
    try {
      if (delta > 0) await rpc('admin_confirm_day', { ...pin, p_code: c.code, p_kind: 'manual' })
      else await rpc('admin_add_stars', { ...pin, p_code: c.code, p_delta: delta, p_kind: 'manual', p_note: 'Ajuste del administrador' })
      await reload()
    } catch (e) { alert(e.message) }
    setBusy(null)
  }
  const del = async (c) => {
    if (!confirm(`¿Eliminar a ${c.name}? Se borran su tarjeta, estrellas y días de regalo. No se puede deshacer.`)) return
    setBusy(c.id)
    try { await rpc('admin_delete_customer', { ...pin, p_code: c.code }); await reload() }
    catch (e) { alert(e.message) }
    setBusy(null)
  }
  const rows = (list || []).filter((c) => (c.name + c.code + (c.phone || '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <h1 className="h1">Clientes</h1>
      <input className="search" placeholder="Buscar por nombre, teléfono o código" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <p className="muted">Los clientes suman su estrella escaneando el QR de estrellas. Usa «+» solo para casos especiales.</p>
      <div className="panel table">
        {list && rows.length === 0 && <p className="muted">No hay clientes que coincidan.</p>}
        {rows.map((c) => (
          <div className="trow" key={c.id}>
            <div className="who"><b>{c.name}</b><span>{c.phone || 'Sin teléfono'} · {c.code}{c.plan_title ? ` · ${c.plan_title}` : ''}</span></div>
            <div className="actions">
              <button className="link danger" disabled={busy === c.id} onClick={() => del(c)}>Eliminar</button>
            </div>
            <time>{c.last_visit ? `Última visita ${when(c.last_visit)}` : 'Sin visitas'}</time>
            <div className="stepper">
              <button disabled={busy === c.id || c.stars < 1} onClick={() => adj(c, -1)} aria-label={`Quitar una estrella a ${c.name}`}>−</button>
              <b>{c.stars} d · {c.bonus_days} 🎁</b>
              <button disabled={busy === c.id} onClick={() => adj(c, 1)} aria-label={`Dar una estrella a ${c.name}`}>+</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function Promos({ pin }) {
  const [list, reload, err] = useRpc('admin_promos', pin)
  const blank = { id: null, title: '', description: '', stars_required: 7, reward_days: 1, active: true }
  const [f, setF] = useState(blank)
  const save = async (e) => {
    e.preventDefault()
    try {
      await rpc('admin_save_promo', { ...pin, p_id: f.id, p_title: f.title, p_desc: f.description, p_stars: Number(f.stars_required), p_active: f.active, p_reward: Number(f.reward_days) })
      setF(blank); reload()
    } catch (x) { alert(x.message) }
  }
  const del = async (p) => { if (confirm(`¿Eliminar «${p.title}»?`)) { await rpc('admin_delete_promo', { ...pin, p_id: p.id }); reload() } }
  return (
    <>
      <h1 className="h1">Planes</h1>
      {err && <p className="err">{err}</p>}
      <form className="panel form grid" onSubmit={save}>
        <h2>{f.id ? 'Editar plan' : 'Nuevo plan'}</h2>
        <label>Título<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="2x1 en bebidas" /></label>
        <label>Días del plan (estrellas)<input required type="number" min="1" value={f.stars_required} onChange={(e) => setF({ ...f, stars_required: e.target.value })} /></label>
        <label>Días de regalo al completar<input required type="number" min="0" value={f.reward_days} onChange={(e) => setF({ ...f, reward_days: e.target.value })} /></label>
        <label className="wide">Descripción<input value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Válido de lunes a jueves" /></label>
        <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Visible para los clientes</label>
        <div className="actions">
          <button className="btn primary">{f.id ? 'Guardar cambios' : 'Crear promoción'}</button>
          {f.id && <button type="button" className="btn" onClick={() => setF(blank)}>Cancelar</button>}
        </div>
      </form>
      <div className="panel">
        <ul className="promos">
          {(list || []).map((p) => (
            <li key={p.id} className={p.active ? 'ok' : 'off'}>
              <div><b>{p.title}</b><span>{p.description}</span></div>
              <em>{p.stars_required} días · +{p.reward_days} regalo{p.active ? '' : ' · oculta'}</em>
              <div className="actions"><button className="link" onClick={() => setF(p)}>Editar</button><button className="link danger" onClick={() => del(p)}>Eliminar</button></div>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

function Premios({ pin }) {
  const [list, reload, err] = useRpc('admin_rewards', pin)
  const blank = { id: null, title: '', description: '', stars_required: '', visible: false }
  const [f, setF] = useState(blank)
  const save = async (e) => {
    e.preventDefault()
    try {
      await rpc('admin_save_reward', { ...pin, p_id: f.id, p_title: f.title, p_desc: f.description || '', p_stars: f.stars_required ? Number(f.stars_required) : null, p_visible: f.visible })
      setF(blank); reload()
    } catch (x) { alert(x.message) }
  }
  const toggle = async (r) => { try { await rpc('admin_set_reward_visible', { ...pin, p_id: r.id, p_visible: !r.visible }); reload() } catch (x) { alert(x.message) } }
  const del = async (r) => { if (confirm(`¿Eliminar «${r.title}»?`)) { await rpc('admin_delete_reward', { ...pin, p_id: r.id }); reload() } }
  return (
    <>
      <h1 className="h1">Premios</h1>
      <p className="muted">Los clientes solo ven los premios que autorices.</p>
      {err && <p className="err">{err}</p>}
      <form className="panel form grid" onSubmit={save}>
        <h2>{f.id ? 'Editar premio' : 'Nuevo premio'}</h2>
        <label>Premio<input required minLength={2} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Camiseta del gimnasio" /></label>
        <label>Estrellas necesarias <small>(opcional)</small><input type="number" min="1" value={f.stars_required ?? ''} onChange={(e) => setF({ ...f, stars_required: e.target.value })} /></label>
        <label className="wide">Descripción<input value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Válido hasta agotar existencias" /></label>
        <label className="check"><input type="checkbox" checked={f.visible} onChange={(e) => setF({ ...f, visible: e.target.checked })} />Autorizado: visible para los clientes</label>
        <div className="actions">
          <button className="btn primary">{f.id ? 'Guardar cambios' : 'Crear premio'}</button>
          {f.id && <button type="button" className="btn" onClick={() => setF(blank)}>Cancelar</button>}
        </div>
      </form>
      <div className="panel">
        {list && list.length === 0 && <p className="muted">Aún no has creado premios.</p>}
        <ul className="promos">
          {(list || []).map((r) => (
            <li key={r.id} className={r.visible ? 'ok' : 'off'}>
              <div><b>{r.title}</b><span>{r.description}</span></div>
              <em>{r.stars_required ? `${r.stars_required} estrellas · ` : ''}{r.visible ? 'Visible' : 'Oculto'}</em>
              <div className="actions">
                <button className="link" onClick={() => toggle(r)}>{r.visible ? 'Ocultar' : 'Autorizar'}</button>
                <button className="link" onClick={() => setF(r)}>Editar</button>
                <button className="link danger" onClick={() => del(r)}>Eliminar</button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

// QR de estrellas: el cliente lo escanea (o toca la etiqueta NFC) para sumar su estrella del día.
function Estrellas({ pin, biz }) {
  const [code, setCode] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [writing, setWriting] = useState(false)
  useEffect(() => { rpc('admin_visit_code', pin).then(setCode).catch((e) => setErr(e.message)) }, [pin])
  if (err) return <p className="err">{err}</p>
  if (!code) return <p className="muted">Cargando…</p>
  const nfcUrl = visitUrl(biz.slug, code, true)
  const regen = async () => {
    if (!confirm('¿Generar un código nuevo? El QR actual y las etiquetas NFC grabadas dejarán de funcionar: tendrás que imprimir el QR y grabar las etiquetas otra vez.')) return
    try { setCode(await rpc('admin_regen_visit_code', pin)); setMsg('Código nuevo generado. Imprime el QR y vuelve a grabar tus etiquetas NFC.') }
    catch (e) { setMsg(e.message) }
  }
  const write = async () => {
    setWriting(true); setMsg('Acerca la etiqueta NFC a la parte de atrás del teléfono…')
    try { await writeNfcUrl(nfcUrl); setMsg('Etiqueta grabada. Pégala en caja: los clientes acercan su teléfono para sumar la estrella.') }
    catch { setMsg('No se pudo grabar la etiqueta. Inténtalo de nuevo.') }
    setWriting(false)
  }
  return (
    <>
      <h1 className="h1 no-print">QR de estrellas</h1>
      <p className="muted no-print">Ponlo en caja o en una pantalla. En cada visita el cliente lo escanea desde su tarjeta («Sumar estrella») y se suma su estrella (puede sumar varias en el día, con 5 min entre una y otra). Es distinto al QR de registro.</p>
      <div className="panel visit-tools no-print">
        <h2>Etiqueta NFC</h2>
        <p className="muted">Graba este mismo código en una etiqueta NFC y pégala en caja. Al acercar el teléfono, el cliente suma su estrella (Android y iPhone).</p>
        <div className="actions">
          {nfcSupported() && <button className="btn primary" disabled={writing} onClick={write}>Grabar etiqueta NFC</button>}
          <button className="btn" onClick={() => { navigator.clipboard?.writeText(nfcUrl); setMsg('Enlace copiado. Grábalo como «URL» con una app como NFC Tools.') }}>Copiar enlace para NFC</button>
          <button className="btn" onClick={regen}>Regenerar código</button>
        </div>
        {!nfcSupported() && <p className="muted">Para grabar desde aquí abre el panel en Chrome para Android, o copia el enlace y grábalo con la app NFC Tools.</p>}
        <p className="muted">Código actual: <span className="visit-code">{code}</span>. Si crees que alguien lo copió, regenéralo.</p>
        {msg && <p className="muted" role="status">{msg}</p>}
      </div>
      <Poster biz={biz} visit={code} />
    </>
  )
}

// Redimir: el admin escanea el QR de la tarjeta del cliente para usar su día gratis.
function Validar({ pin }) {
  const [mode, setMode] = useState('qr')
  const [manual, setManual] = useState('')
  const [res, setRes] = useState(null)

  const find = useCallback(async (code) => {
    try {
      const l = await rpc('admin_lookup', { ...pin, p_code: code })
      setRes({ ok: true, ...l, note: l.bonus_days > 0 ? 'Este cliente tiene día gratis disponible.' : 'Este cliente aún no tiene días de regalo.' })
      navigator.vibrate?.(80)
    } catch (e) { setRes({ ok: false, msg: e.message }) }
  }, [pin])

  const useGift = async () => {
    try {
      const r = await rpc('admin_use_bonus_day', { ...pin, p_code: res.code })
      setRes({ ok: true, ...r, note: r.closed ? 'Día gratis redimido. La tarjeta y los datos del cliente fueron eliminados.' : `Día gratis redimido. Le quedan ${r.bonus_days}.` })
    } catch (e) { setRes({ ok: false, msg: e.message }) }
  }

  return (
    <>
      <h1 className="h1">Redimir día gratis</h1>
      <p className="muted">Escanea el QR de la tarjeta del cliente. Las estrellas ya no se suman aquí: el cliente las suma con el QR de estrellas.</p>
      <div className="seg" role="tablist">
        {[['qr', 'Escanear QR'], ['code', 'Escribir código']].map(([k, l]) =>
          <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setRes(null) }}>{l}</button>)}
      </div>
      <div className="panel">
        {mode === 'qr' && <QrScanner active onCode={find} />}
        {mode === 'code' && (
          <form className="form inline" onSubmit={(e) => { e.preventDefault(); const c = parseCode(manual) || manual.trim().toUpperCase(); if (c) find(c); setManual('') }}>
            <label>Código de tarjeta<input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="A1B2C3D4" maxLength={12} /></label>
            <button className="btn primary">Buscar</button>
          </form>
        )}
      </div>

      {res && (
        <div className={`result ${res.ok ? 'good' : 'bad'}`} role="status">
          {res.ok ? (
            <>
              <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="46" className="ring" /><path d="M38 62l15 15 30-34" className="tick" /></svg>
              <div>
                <b>{res.name}</b>
                <span>{res.note}</span>
                <span>{res.stars} estrellas · {res.bonus_days} de regalo disponibles</span>
                {res.bonus_days > 0 && !res.closed && <div className="actions"><button className="btn primary" onClick={useGift}>Redimir día gratis</button></div>}
              </div>
            </>
          ) : <div><b>No se pudo validar</b><span>{res.msg}</span></div>}
        </div>
      )}
    </>
  )
}

function Ajustes({ pin }) {
  const [d, , err] = useRpc('admin_overview', pin)
  const [f, setF] = useState(null)
  const [done, setDone] = useState('')
  useEffect(() => { if (d) setF({ color: d.color, newPin: '' }) }, [d])
  if (err) return <p className="err">{err}</p>
  if (!f) return <p className="muted">Cargando…</p>
  const save = async (e) => {
    e.preventDefault()
    try {
      await rpc('admin_save_settings', { ...pin, p_color: f.color, p_new_pin: f.newPin || null })
      if (f.newPin) { try { sessionStorage.removeItem(KEY) } catch {} }
      setDone(f.newPin ? 'Guardado. Pulsa «Salir» y entra con el nuevo PIN.' : 'Cambios guardados.')
    } catch (x) { setDone(x.message) }
  }
  return (
    <>
      <h1 className="h1">Ajustes</h1>
      <form className="panel form grid" onSubmit={save}>
        <label>Color de la tarjeta<input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
        <label>Nuevo PIN <small>(vacío para conservar el actual)</small><input type="password" inputMode="numeric" value={f.newPin} onChange={(e) => setF({ ...f, newPin: e.target.value })} minLength={4} /></label>
        <div className="actions"><button className="btn primary">Guardar</button></div>
        {done && <p className="muted" role="status">{done}</p>}
      </form>
    </>
  )
}
