import Fireworks from './Fireworks.jsx'
import { useCallback, useEffect, useState } from 'react'
import { rpc } from './supabase.js'
import { QrScanner, useNfcReader, parseCode, assignTag, nfcSupported } from './Scanner.jsx'

const PIN_KEY = 'fid_admin_pin'
const getPin = () => { try { return sessionStorage.getItem(PIN_KEY) } catch { return null } }
const when = (iso) => new Date(iso).toLocaleString('es', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

export default function Admin() {
  const [pin, setPin] = useState(getPin())
  if (!pin) return <Gate onOk={(p) => { try { sessionStorage.setItem(PIN_KEY, p) } catch {} ; setPin(p) }} />
  return <Dash pin={pin} onExit={() => { try { sessionStorage.removeItem(PIN_KEY) } catch {} ; setPin(null) }} />
}

function Gate({ onOk }) {
  const [v, setV] = useState('')
  const [err, setErr] = useState('')
  const go = async (e) => {
    e.preventDefault()
    try { (await rpc('admin_check', { p_pin: v })) ? onOk(v) : setErr('PIN incorrecto') }
    catch (x) { setErr(x.message) }
  }
  return (
    <main className="shell narrow">
      <h1 className="hero sm">Acceso del negocio</h1>
      <form className="panel form" onSubmit={go}>
        <label>PIN<input type="password" inputMode="numeric" autoFocus value={v} onChange={(e) => setV(e.target.value)} /></label>
        {err && <p className="err">{err}</p>}
        <button className="btn primary">Entrar</button>
      </form>
    </main>
  )
}

const TABS = [['panel', 'Panel'], ['clientes', 'Clientes'], ['promos', 'Promociones'], ['validar', 'Validar'], ['ajustes', 'Ajustes']]

function Dash({ pin, onExit }) {
  const [tab, setTab] = useState('panel')
  return (
    <div className="admin">
      <nav className="side" aria-label="Administración">
        <div className="logo"><svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.5l-6 3.4 1.3-6.7-5-4.7 6.8-.8z" /></svg>Estrellas</div>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
        <button className="exit" onClick={onExit}>Salir</button>
      </nav>
      <section className="content">
        {tab === 'panel' && <Panel pin={pin} />}
        {tab === 'clientes' && <Clientes pin={pin} />}
        {tab === 'promos' && <Promos pin={pin} />}
        {tab === 'validar' && <Validar pin={pin} />}
        {tab === 'ajustes' && <Ajustes pin={pin} />}
      </section>
    </div>
  )
}

function useRpc(fn, pin) {
  const [data, set] = useState(null)
  const [err, setErr] = useState('')
  const reload = useCallback(() => rpc(fn, { p_pin: pin }).then(set).catch((e) => setErr(e.message)), [fn, pin])
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
  const adj = async (c, delta) => {
    setBusy(c.id)
    try { await rpc('admin_add_stars', { p_pin: pin, p_code: c.code, p_delta: delta, p_kind: 'manual', p_note: 'Ajuste del administrador' }); await reload() }
    catch (e) { alert(e.message) }
    setBusy(null)
  }
  const [asg, setAsg] = useState(null) // cliente esperando etiqueta
  const [asgMsg, setAsgMsg] = useState('')
  useEffect(() => {
    if (!asg) return
    const ctrl = new AbortController()
    setAsgMsg('')
    assignTag(asg.code, ctrl.signal)
      .then(async ({ uid, written }) => {
        await rpc('admin_assign_nfc', { p_pin: pin, p_code: asg.code, p_uid: uid })
        setAsgMsg(`Etiqueta ${uid} asignada a ${asg.name}${written ? '' : ' (solo por número de serie)'}.`)
        setAsg(null); reload()
      })
      .catch((e) => { if (!ctrl.signal.aborted) { setAsgMsg(e.message || 'No se pudo asignar'); setAsg(null) } })
    return () => ctrl.abort()
  }, [asg, pin, reload])
  const unassign = async (c) => { try { await rpc('admin_assign_nfc', { p_pin: pin, p_code: c.code, p_uid: '' }); reload() } catch (e) { alert(e.message) } }
  const rows = (list || []).filter((c) => (c.name + c.code + (c.phone || '')).toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <h1 className="h1">Clientes</h1>
      <input className="search" placeholder="Buscar por nombre, teléfono o código" value={q} onChange={(e) => setQ(e.target.value)} />
      {err && <p className="err">{err}</p>}
      {asg && <p className="muted" role="status">Acerca una etiqueta o tarjeta NFC al teléfono para asignarla a {asg.name}… <button className="link" onClick={() => setAsg(null)}>Cancelar</button></p>}
      {asgMsg && <p className="muted" role="status">{asgMsg}</p>}
      {!nfcSupported() && <p className="muted">Para asignar NFC abre el panel en Chrome para Android.</p>}
      <div className="panel table">
        {list && rows.length === 0 && <p className="muted">No hay clientes que coincidan.</p>}
        {rows.map((c) => (
          <div className="trow" key={c.id}>
            <div className="who"><b>{c.name}</b><span>{c.phone || 'Sin teléfono'} · {c.code}{c.nfc_uid ? ' · NFC ✓' : ''}</span></div>
            <div className="actions">
              <button className="link" disabled={!nfcSupported() || !!asg} onClick={() => setAsg(c)}>{c.nfc_uid ? 'Reasignar NFC' : 'Asignar NFC'}</button>
              {c.nfc_uid && <button className="link danger" onClick={() => unassign(c)}>Quitar NFC</button>}
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
  const blank = { id: null, title: '', description: '', stars_required: 5, active: true }
  const [f, setF] = useState(blank)
  const save = async (e) => {
    e.preventDefault()
    try {
      await rpc('admin_save_promo', { p_pin: pin, p_id: f.id, p_title: f.title, p_desc: f.description, p_stars: Number(f.stars_required), p_active: f.active })
      setF(blank); reload()
    } catch (x) { alert(x.message) }
  }
  const del = async (p) => { if (confirm(`¿Eliminar «${p.title}»?`)) { await rpc('admin_delete_promo', { p_pin: pin, p_id: p.id }); reload() } }
  return (
    <>
      <h1 className="h1">Promociones</h1>
      {err && <p className="err">{err}</p>}
      <form className="panel form grid" onSubmit={save}>
        <h2>{f.id ? 'Editar promoción' : 'Nueva promoción'}</h2>
        <label>Título<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="2x1 en bebidas" /></label>
        <label>Estrellas necesarias<input required type="number" min="1" value={f.stars_required} onChange={(e) => setF({ ...f, stars_required: e.target.value })} /></label>
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
              <em>{p.stars_required} ★{p.active ? '' : ' · oculta'}</em>
              <div className="actions"><button className="link" onClick={() => setF(p)}>Editar</button><button className="link danger" onClick={() => del(p)}>Eliminar</button></div>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

function Validar({ pin }) {
  const [mode, setMode] = useState('qr')
  const [manual, setManual] = useState('')
  const [res, setRes] = useState(null)

  const [boom, setBoom] = useState(0)

  const find = useCallback(async (code) => {
    try {
      const r = await rpc('admin_confirm_day', { p_pin: pin, p_code: code, p_kind: mode === 'nfc' ? 'nfc' : 'scan' })
      const note = `Día ${r.day} de 14 confirmado · +1 estrella${r.gift ? ` · ¡+${r.gift} ${r.gift === 1 ? 'día' : 'días'} de regalo!` : ''}${r.completed ? ' · ciclo completo' : ''}`
      setRes({ ok: true, ...r, note }); setBoom((n) => n + 1); navigator.vibrate?.([60, 40, 120])
    } catch (e) { setRes({ ok: false, msg: e.message }) }
  }, [pin, mode])

  const nfc = useNfcReader((c) => find(c), mode === 'nfc')
  const act = async (fn, args, note) => {
    try { const r = await rpc(fn, { p_pin: pin, p_code: res.code, ...args }); setRes({ ok: true, ...r, note: note(r) }) }
    catch (e) { setRes({ ok: false, msg: e.message }) }
  }
  const useGift = () => act('admin_use_bonus_day', {}, () => 'Día de regalo aplicado.')

  return (
    <>
      <Fireworks show={boom > 0} key={boom} />
      <h1 className="h1">Validar tarjeta</h1>
      <div className="seg" role="tablist">
        {[['qr', 'Escanear QR'], ['nfc', 'Leer NFC'], ['code', 'Escribir código']].map(([k, l]) =>
          <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'on' : ''} onClick={() => { setMode(k); setRes(null) }}>{l}</button>)}
      </div>
      <div className="panel">
        {mode === 'qr' && <QrScanner active onCode={find} />}
        {mode === 'nfc' && (
          <div className="nfc">
            <div className={`pulse ${nfc === 'listening' ? 'live' : ''}`} aria-hidden />
            <p>
              {nfc === 'unsupported' && 'Este dispositivo no admite NFC en el navegador. Usa Chrome en Android o escanea el QR.'}
              {nfc === 'denied' && 'Permiso de NFC denegado. Actívalo en los ajustes del sitio.'}
              {nfc === 'unknown' && 'La etiqueta no tiene una tarjeta válida.'}
              {(nfc === 'idle' || nfc === 'listening') && 'Acerca la etiqueta NFC del cliente.'}
            </p>
          </div>
        )}
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
                <span>{res.note || 'Día pagado confirmado.'}</span>
                <span>{res.stars} días pagados · {res.bonus_days} de regalo disponibles</span>
                <div className="actions">
                  <button className="btn" disabled={res.bonus_days < 1} onClick={useGift}>Usar día de regalo</button>
                </div>
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
  useEffect(() => { if (d) setF({ business: d.business, color: d.color, goal: d.goal, newPin: '' }) }, [d])
  if (err) return <p className="err">{err}</p>
  if (!f) return <p className="muted">Cargando…</p>
  const save = async (e) => {
    e.preventDefault()
    try {
      await rpc('admin_save_settings', { p_pin: pin, p_business: f.business, p_color: f.color, p_goal: Number(f.goal), p_new_pin: f.newPin || null })
      if (f.newPin) { try { sessionStorage.removeItem(PIN_KEY) } catch {} }
      setDone(f.newPin ? 'Guardado. Pulsa «Salir» y entra con el nuevo PIN.' : 'Cambios guardados.')
    } catch (x) { setDone(x.message) }
  }
  return (
    <>
      <h1 className="h1">Ajustes</h1>
      <form className="panel form grid" onSubmit={save}>
        <label>Nombre del negocio<input value={f.business} onChange={(e) => setF({ ...f, business: e.target.value })} required /></label>
        <label>Color de la tarjeta<input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} /></label>
        <label>Estrellas visibles en la tarjeta<input type="number" min="3" max="20" value={f.goal} onChange={(e) => setF({ ...f, goal: e.target.value })} /></label>
        <label>Nuevo PIN <small>(vacío para conservar el actual)</small><input type="password" inputMode="numeric" value={f.newPin} onChange={(e) => setF({ ...f, newPin: e.target.value })} minLength={4} /></label>
        <div className="actions"><button className="btn primary">Guardar</button></div>
        {done && <p className="muted" role="status">{done}</p>}
      </form>
    </>
  )
}
