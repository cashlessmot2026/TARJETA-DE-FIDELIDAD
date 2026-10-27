# Tarjetas de fidelidad (multi-negocio) · Resumen para continuar

Última actualización: 27 de octubre de 2026

- **Repo:** https://github.com/cashlessmot2026/TARJETA-DE-FIDELIDAD (rama `main`; GitHub Actions publica en GitHub Pages en cada push)
- **Dominio:** `fidelizacion.shop` (GoDaddy, comprado el 27-oct-2026). Mientras se activa: https://cashlessmot2026.github.io/TARJETA-DE-FIDELIDAD/
- **Supabase (nuevo):** proyecto `shrkfzuxpmwkyyqjzcmb` → API `https://shrkfzuxpmwkyyqjzcmb.supabase.co` (URL y anon key en `src/supabase.js`). El proyecto viejo `pirshjvxhxrqfqyajuxp` ya no se usa (sus datos no se migraron).
- **Stack:** Vite + React (`src/`), Supabase con RPC `security definer` y RLS sin políticas (el anon key solo ejecuta funciones RPC).
- **PINs:** el superadmin y el negocio `principal` arrancan con el PIN por defecto del SQL. Cambiarlos (`#/super` → Ajustes, mínimo 6 dígitos; `#/admin/principal` → Ajustes). No guardar PINs en este archivo: el repo es público.
- **Empresa:** Cashless Colombia · cashlesscolombia@gmail.com · +57 319 2153328

## Rutas
| Ruta | Para quién | Qué hace |
|---|---|---|
| `#/super` | Superadmin | Crea/edita negocios: nombre, correo, logo (el color de la tarjeta sale automático del logo), enlace, PIN del admin, activo. Vista previa en vivo de la tarjeta. Descarga afiche/QR y copia el enlace del admin. |
| `#/admin/<negocio>` | Admin del negocio | Panel, Clientes (solo los suyos), Planes, Premios, Validar (QR/NFC/código), Código QR (afiche), Ajustes (color y PIN). |
| `#/r/<negocio>` | Cliente | Registro en ese negocio (es lo que abre el QR del afiche). Si ya tiene tarjeta de ese negocio, la abre. |
| `#/c/<token>` | Cliente | Su tarjeta. |
| `#/` | Cliente | «Mis tarjetas» (una por negocio; si tiene una sola, la abre directo). |
| `/privacidad/` | Público (oculta, `noindex`) | Política de privacidad (Ley 1581 de 2012, Colombia). |

## Decisiones tomadas
- Cada negocio define sus propios planes y premios.
- Acceso del admin: enlace del negocio + PIN. Superadmin con PIN maestro.
- Google Wallet: **pospuesto** hasta que Google apruebe la cuenta. El botón está oculto.
- QR: afiche imprimible/PDF + PNG, descargable por el superadmin y por el admin del negocio.
- Varios negocios en un mismo teléfono: lista «Mis tarjetas».
- Premios: solo se muestran al cliente cuando el admin los autoriza (`visible`).
- Al registrarse, el cliente ve una ventana para instalar la tarjeta como app (PWA). Android: botón «Descargar app»; iPhone: instrucciones (Compartir → Agregar a inicio); navegadores de WhatsApp/Instagram: pide abrir en Chrome.

## Base de datos
Para un proyecto nuevo, en Supabase → SQL Editor ejecutar **en orden**:
1. `supabase/schema.sql`
2. `supabase/multinegocio.sql`

Ya están aplicados en `shrkfzuxpmwkyyqjzcmb` (verificado: `super_check` responde).

Tablas: `businesses`, `customers` (con `business_id`), `visits`, `promotions` (= planes, con `business_id`), `rewards` (premios, con `business_id` y `visible`), `settings` (`super_pin_hash`, etc.).

Funciones RPC:
- **Cliente:** `app_business(slug)`, `app_register(biz, name, phone, plan)`, `app_get_card(token)`, `app_cards(tokens[])`, `app_choose_plan(token, plan)`.
- **Admin (todas reciben `p_biz`, `p_pin`):** `admin_check`, `admin_overview`, `admin_customers`, `admin_add_stars`, `admin_assign_nfc`, `admin_lookup`, `admin_confirm_day`, `admin_use_bonus_day`, `admin_delete_customer`, `admin_promos`, `admin_save_promo`, `admin_delete_promo`, `admin_rewards`, `admin_save_reward`, `admin_set_reward_visible`, `admin_delete_reward`, `admin_save_settings`.
- **Superadmin:** `super_check`, `super_businesses`, `super_save_business`, `super_set_pin`.

## Reglas de negocio
- 1 visita/día confirmado = 1 estrella (máximo una confirmación cada 12 h por cliente).
- Al llegar a la meta del plan se suman los días de regalo del plan.
- Al redimir el último día gratis se elimina la tarjeta y los datos del cliente.
- Un negocio nuevo arranca con «Plan 10 visitas» (+1 de regalo), editable por su admin.

## Archivos clave
- `src/Super.jsx` superadmin · `src/Admin.jsx` admin del negocio · `src/Customer.jsx` cliente · `src/Card.jsx` tarjeta
- `src/Poster.jsx` afiche QR · `src/logo.js` logo → imagen pequeña + color automático · `src/cards.js` tarjetas guardadas en el teléfono
- `src/install.js` + `public/sw.js` + `public/manifest.webmanifest` instalación como app
- `public/privacidad/index.html` política de privacidad

## Google Wallet (pausado)
- Consola: https://pay.google.com/business/console · emisor `3388000000023205246` · cuenta «cashless colombia» · en modo Demo.
- La solicitud de publicación fue rechazada. Problemas encontrados: el sitio `cashlessco.online` no existe; la clase `fidelidad` tiene nombre «Mi Negocio», país `MX` y no tiene imagen destacada; el perfil no tiene logo.
- Pendiente: cambiar el sitio web y la URL de soporte a `https://fidelizacion.shop`, política en `https://fidelizacion.shop/privacidad/`, corregir la clase, subir el logo y volver a solicitar. Para varios negocios: una clase (o un emisor) por negocio; preguntar a soporte de Google cuál aceptan.
- La Edge Function `wallet-pass` y `scripts/create-wallet-class.mjs` son del proyecto viejo y de un solo negocio.

## Dominio `fidelizacion.shop`
- DNS en GoDaddy: `CNAME www → cashlessmot2026.github.io` ✅; `A @ → 185.199.108.153` ✅. Faltan los A `185.199.109.153`, `185.199.110.153` y `185.199.111.153`.
- GitHub → Settings → Pages: dominio puesto; daba `InvalidDNSError` porque el dominio era recién comprado. Cuando resuelva: «Comprueba de nuevo» y luego «Enforce HTTPS».

## Pendientes
1. Cambiar el PIN del superadmin y el del negocio `principal`.
2. Terminar el DNS (3 registros A) y activar HTTPS en GitHub Pages.
3. Probar en celulares reales: registro por QR, instalación como app (Android e iPhone), validación QR/NFC, afiche impreso.
4. Cambiar los textos de «días» («Días de regalo», «días pagados») por «visitas/premios» para negocios que no son gimnasio.
5. Google Wallet por negocio (cuando Google apruebe la cuenta).
6. Opcional: invitación por correo al admin del negocio; migrar datos del proyecto viejo si hace falta.

## Cómo retomar
Abre Claude Code en la carpeta del proyecto y pide: «lee CONVERSACION.md y sigamos con …».
Local: `npm run dev` → http://localhost:5173 (se conecta a la base real de Supabase).
