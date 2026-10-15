// Edge Function: emite / sincroniza la tarjeta de Google Wallet de un cliente.
// Secretos requeridos (supabase secrets set ...):
//   GOOGLE_SA_JSON      contenido del JSON de la cuenta de servicio
//   WALLET_ISSUER_ID    ID del emisor (Pay & Wallet Console)
// SUPABASE_URL y SUPABASE_ANON_KEY los inyecta Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SA = JSON.parse(Deno.env.get('GOOGLE_SA_JSON') ?? '{}')
const ISSUER = Deno.env.get('WALLET_ISSUER_ID') ?? ''
const CLASS_ID = `${ISSUER}.fidelidad`
const API = 'https://walletobjects.googleapis.com/walletobjects/v1'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const b64u = (data: string | Uint8Array) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  let s = ''
  bytes.forEach((b) => (s += String.fromCharCode(b)))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function signJwt(payload: Record<string, unknown>) {
  const pem = (SA.private_key as string).replace(/-----[^-]+-----|\s/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: SA.private_key_id }))
  const body = b64u(JSON.stringify(payload))
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`)))
  return `${head}.${body}.${b64u(sig)}`
}

async function accessToken() {
  const now = Math.floor(Date.now() / 1000)
  const assertion = await signJwt({
    iss: SA.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
    aud: SA.token_uri, iat: now, exp: now + 3600,
  })
  const r = await fetch(SA.token_uri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  return (await r.json()).access_token as string
}

type Card = { name: string; code: string; stars: number; goal: number; business: string; visits: { at: string; delta: number }[] }

const walletObject = (c: Card) => ({
  id: `${ISSUER}.${c.code}`,
  classId: CLASS_ID,
  state: 'ACTIVE',
  accountId: c.code,
  accountName: c.name,
  barcode: { type: 'QR_CODE', value: `FID:${c.code}`, alternateText: c.code },
  loyaltyPoints: { label: 'Estrellas', balance: { int: c.stars } },
  textModulesData: [{
    id: 'visitas', header: 'Últimas visitas',
    body: c.visits.filter((v) => v.delta > 0).slice(0, 5)
      .map((v) => new Date(v.at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })).join(' · ') || 'Aún sin visitas',
  }],
})

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!SA.private_key || !ISSUER) return json({ error: 'Wallet no configurado' }, 500)
    const { token, action = 'save' } = await req.json()
    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
    const { data: card, error } = await sb.rpc('app_get_card', { p_token: token })
    if (error || !card) return json({ error: 'Tarjeta no encontrada' }, 404)
    const obj = walletObject(card as Card)

    if (action === 'sync') {
      // Actualiza las estrellas del pase ya guardado (404 = aún no lo guardó).
      const at = await accessToken()
      const r = await fetch(`${API}/loyaltyObject/${encodeURIComponent(obj.id)}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ loyaltyPoints: obj.loyaltyPoints, textModulesData: obj.textModulesData }),
      })
      return json({ ok: r.ok, status: r.status })
    }

    const now = Math.floor(Date.now() / 1000)
    const jwt = await signJwt({
      iss: SA.client_email, aud: 'google', typ: 'savetowallet', iat: now,
      payload: { loyaltyObjects: [obj] },
    })
    return json({ url: `https://pay.google.com/gp/v/save/${jwt}` })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
