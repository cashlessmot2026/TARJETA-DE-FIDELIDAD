// Tarjetas guardadas en este teléfono: una por negocio. [{ token, biz }]
const KEY = 'fid_cards'
const OLD = 'fid_token' // versión de un solo negocio

export function loadCards() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]')
    const old = localStorage.getItem(OLD)
    if (old && !list.some((c) => c.token === old)) list.push({ token: old, biz: null })
    return list
  } catch { return [] }
}

function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); localStorage.removeItem(OLD) } catch {}
}

export function saveCard(token, biz = null) {
  const list = loadCards()
  const hit = list.find((c) => c.token === token)
  if (hit) { if (biz && hit.biz !== biz) { hit.biz = biz; store(list) } return }
  store([...list, { token, biz }])
}

export function removeCard(token) {
  store(loadCards().filter((c) => c.token !== token))
}

export const cardForBiz = (biz) => loadCards().find((c) => c.biz === biz)
