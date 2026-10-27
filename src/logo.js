// Convierte el logo subido en una imagen pequeña (data URL) y saca su color principal
// para diseñar la tarjeta automáticamente.
const MAX = 256

export async function readLogo(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((ok, fail) => {
      const i = new Image()
      i.onload = () => ok(i)
      i.onerror = () => fail(new Error('No se pudo leer la imagen'))
      i.src = url
    })
    const k = Math.min(1, MAX / Math.max(img.width, img.height))
    const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k))
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0, w, h)
    return { dataUrl: c.toDataURL('image/png'), color: mainColor(ctx.getImageData(0, 0, w, h).data) }
  } finally { URL.revokeObjectURL(url) }
}

// Color más frecuente ignorando transparentes, blancos, negros y grises.
function mainColor(px) {
  const buckets = new Map()
  for (let i = 0; i < px.length; i += 16) {
    const [r, g, b, a] = [px[i], px[i + 1], px[i + 2], px[i + 3]]
    if (a < 128) continue
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    if (max < 40 || min > 225 || max - min < 40) continue
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5)
    const s = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 }
    s.n++; s.r += r; s.g += g; s.b += b
    buckets.set(key, s)
  }
  let best = null
  for (const s of buckets.values()) if (!best || s.n > best.n) best = s
  if (!best) return '#5CE1B0'
  const hex = (v) => Math.round(v / best.n).toString(16).padStart(2, '0')
  return `#${hex(best.r)}${hex(best.g)}${hex(best.b)}`.toUpperCase()
}

// «Panadería La Espiga» → «panaderia-la-espiga»
export const slugify = (s) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
