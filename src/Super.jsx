import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import Card from './Card.jsx'
import Poster from './Poster.jsx'
import { readLogo, slugify } from './logo.js'

// Superadmin (#/super): crea los negocios, su logo, su tarjeta y su QR de registro.
const KEY = 'fid_super'
const getPin = () => { try { return sessionStorage.getItem(KEY) } catch { return null } }
const adminUrl = (slug) => `${location.origin}${location.pathname}#/admin/${slug}`

export default function Super() {
  const [pin, setPin] = useState(getPin())
  if (!pin) return <Gate onOk={(p) => { try { sessionStorage.setItem(KEY, p) } catch {} ; setPin(p) }} />
  return <Dash pin={pin} onExit={() => { try { sessionStorage.removeItem(KEY) } catch {} ; setPin(null) }} />
}

function Gate({ onOk }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState('')
  const go = async (e) => {
    e.preventDefault()
    try { await rpc('super_check', { p_pin: v }); onOk(v) } catch (x) { setErr(x.message) }
  }
  return (
    <main className="shell narrow">
      <h1 className="hero sm">Superadmin</h1>
      <form className="panel form" onSubmit={go}>
        <label>PIN maestro<input type="password" inputMode="numeric" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary">Entrar</button>
      </form>
    </main>
  )
}

const TABS = [['negocios', 'Negocios'], ['ajustes', 'Ajustes']]

function Dash({ pin, onExit }) {
  const [tab, setTab] = useState('negocios')
  return (
    <div className="admin">
      <nav className="side no-print" aria-label="Superadmin">
        <div className="logo"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z" /></svg>Superadmin</div>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        <button className="exit" onClick={onExit}>Salir</button>
      </nav>
      <section className="content">
        {tab === 'negocios' && <Negocios pin={pin} />}
        {tab === 'ajustes' && <Ajustes pin={pin} />}
      </section>
    </div>
  )
}

const blank = { id: null, name: '', slug: '', email: '', logo: null, color: '#5CE1B0', adminPin: '', active: true }

function Negocios({ pin }) {
  const [list, setList] = useState(null)
  const [err, setErr] = useState('')
  const [f, setF] = useState(blank)
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [poster, setPoster] = useState(null)
  const reload = useCallback(() => rpc('super_businesses', { p_pin: pin }).then(setList).catch((e) => setErr(e.message)), [pin])
  useEffect(() => { reload() }, [reload])

  const setName = (name) => setF((x) => ({ ...x, name, slug: slugTouched || x.id ? x.slug : slugify(name) }))
  const onLogo = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try { const { dataUrl, color } = await readLogo(file); setF((x) => ({ ...x, logo: dataUrl, color })) }
    catch (x) { setMsg(x.message) }
  }
  const edit = (b) => { setF({ ...b, adminPin: '' }); setSlugTouched(true); setMsg(''); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const reset = () => { setF(blank); setSlugTouched(false) }
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setMsg('')
    try {
      const r = await rpc('super_save_business', {
        p_pin: pin, p_id: f.id, p_slug: f.slug, p_name: f.name, p_email: f.email || '',
        p_logo: f.logo, p_color: f.color, p_admin_pin: f.adminPin || null, p_active: f.active,
      })
      setMsg(f.id ? 'Cambios guardados.' : `Negocio creado. Admin: ${adminUrl(r.slug)} con el PIN que elegiste.`)
      reset(); reload()
    } catch (x) { setMsg(x.message) }
    setBusy(false)
  }

  if (poster) return (
    <>
      <button className="link no-print" onClick={() => setPoster(null)}>‹ Volver a negocios</button>
      <h1 className="h1 no-print">QR de {poster.name}</h1>
      <Poster biz={poster} />
    </>
  )

  const sample = { business: f.name || 'Nombre del negocio', name: 'Cliente de ejemplo', code: 'ABCD1234', stars: 3, goal: 10, visits: [], bonus_days: 0, color: f.color, logo: f.logo }
  return (
    <>
      <h1 className="h1">Negocios</h1>
      {err && <p className="err">{err}</p>}
      <div className="biz-editor">
        <form className="panel form grid" onSubmit={save}>
          <h2>{f.id ? `Editar ${f.name}` : 'Nuevo negocio'}</h2>
          <label>Nombre del negocio<input required minLength={2} value={f.name} onChange={(e) => setName(e.target.value)} placeholder="Panadería La Espiga" /></label>
          <label>Correo del negocio<input type="email" value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="contacto@negocio.com" /></label>
          <label>Enlace <small>(va en el QR)</small><input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={f.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: slugify(e.target.value) }) }} /></label>
          <label>PIN del admin {f.id && <small>(vacío para conservar)</small>}<input type="password" inputMode="numeric" minLength={4} required={!f.id} value={f.adminPin} onChange={(e) => setF({ ...f, adminPin: e.target.value })} /></label>
          <label>Logo<input type="file" accept="image/*" onChange={onLogo} /></label>
          <label>Color de la tarjeta <small>(sale del logo)</small><input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value.toUpperCase() })} /></label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo (sus clientes pueden registrarse)</label>
          <div className="actions">
            <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : f.id ? 'Guardar cambios' : 'Crear negocio'}</button>
            {f.id && <button type="button" className="btn" onClick={reset}>Cancelar</button>}
          </div>
          {msg && <p className="muted" role="status">{msg}</p>}
        </form>
        <div className="biz-preview">
          <p className="muted">Así se verá la tarjeta</p>
          <Card card={sample} flipped={false} onFlip={() => {}} />
        </div>
      </div>

      <div className="panel table">
        {list && list.length === 0 && <p className="muted">Aún no hay negocios.</p>}
        {(list || []).map((b) => (
          <div className="trow biz-row" key={b.id}>
            <div className="who">
              <b>{b.logo ? <img className="row-logo" src={b.logo} alt="" /> : <span className="row-dot" style={{ background: b.color }} />}{b.name}{!b.active && ' · inactivo'}</b>
              <span>{b.email || 'Sin correo'} · /{b.slug} · {b.customers} {b.customers === 1 ? 'cliente' : 'clientes'}</span>
            </div>
            <div className="actions">
              <button className="link" onClick={() => setPoster(b)}>QR y afiche</button>
              <button className="link" onClick={() => navigator.clipboard?.writeText(adminUrl(b.slug))}>Copiar enlace admin</button>
              <button className="link" onClick={() => edit(b)}>Editar</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function Ajustes({ pin }) {
  const [v, setV] = useState('')
  const [msg, setMsg] = useState('')
  const save = async (e) => {
    e.preventDefault()
    try { await rpc('super_set_pin', { p_pin: pin, p_new_pin: v }); try { sessionStorage.removeItem(KEY) } catch {} ; setMsg('PIN cambiado. Pulsa «Salir» y entra con el nuevo PIN.') }
    catch (x) { setMsg(x.message) }
  }
  return (
    <>
      <h1 className="h1">Ajustes</h1>
      <form className="panel form grid" onSubmit={save}>
        <label>Nuevo PIN maestro <small>(mínimo 6 dígitos)</small><input type="password" inputMode="numeric" minLength={6} required value={v} onChange={(e) => setV(e.target.value)} /></label>
        <div className="actions"><button className="btn primary">Cambiar PIN</button></div>
        {msg && <p className="muted" role="status">{msg}</p>}
      </form>
    </>
  )
}
