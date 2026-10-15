// Crea (una sola vez) la clase de tarjeta de lealtad en Google Wallet.
// Uso: GOOGLE_SA_FILE=ruta/sa.json WALLET_ISSUER_ID=338... node scripts/create-wallet-class.mjs
import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

const sa = JSON.parse(readFileSync(process.env.GOOGLE_SA_FILE, 'utf8'))
const ISSUER = process.env.WALLET_ISSUER_ID
const CLASS_ID = `${ISSUER}.fidelidad`
const LOGO = process.env.WALLET_LOGO_URL ||
  'https://raw.githubusercontent.com/cashlessmot2026/TARJETA-DE-FIDELIDAD/main/public/wallet-logo.png'
const b64u = (b) => Buffer.from(b).toString('base64url')

function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }))
  const body = b64u(JSON.stringify(payload))
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(sa.private_key)
  return `${head}.${body}.${b64u(sig)}`
}

const now = Math.floor(Date.now() / 1000)
const assertion = signJwt({
  iss: sa.client_email, scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
  aud: sa.token_uri, iat: now, exp: now + 3600,
})
const tok = await fetch(sa.token_uri, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
}).then((r) => r.json())
if (!tok.access_token) { console.error('Sin token:', tok); process.exit(1) }

const cls = {
  id: CLASS_ID,
  issuerName: process.env.WALLET_BUSINESS || 'Mi Negocio',
  programName: 'Tarjeta de estrellas',
  programLogo: { sourceUri: { uri: LOGO }, contentDescription: { defaultValue: { language: 'es', value: 'Logo' } } },
  hexBackgroundColor: process.env.WALLET_COLOR || '#0f8f66',
  reviewStatus: 'UNDER_REVIEW',
  countryCode: 'MX',
}
const res = await fetch('https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass', {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(cls),
})
console.log(res.status, JSON.stringify(await res.json(), null, 2))
