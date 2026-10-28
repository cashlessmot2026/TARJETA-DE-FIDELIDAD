# Tarjetas de fidelidad (multi-negocio) · Resumen para continuar

Última actualización: 28 de octubre de 2026

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
| `#/admin/<negocio>` | Admin del negocio | Panel, QR de estrellas (afiche, grabar/probar NFC, regenerar), Clientes, Premios, Canjear (premios), QR de registro, Ajustes. |
| `#/r/<negocio>` | Cliente | Registro en ese negocio (es lo que abre el QR del afiche). Si ya tiene tarjeta de ese negocio, la abre. |
| `#/c/<token>` | Cliente | Su tarjeta (botón «Sumar estrella»). |
| `#/v/<negocio>/<código>[/nfc]` | Cliente | Suma la estrella (QR de estrellas o etiqueta NFC). Si el navegador no tiene la tarjeta, pide el teléfono. |
| `#/` | Cliente | «Mis tarjetas» (una por negocio; si tiene una sola, la abre directo). |
| `/privacidad/` | Público (oculta, `noindex`) | Política de privacidad (Ley 1581 de 2012, Colombia). |

## Decisiones tomadas
- Cada negocio define sus propios premios (los planes se eliminaron el 28-oct; la tabla `promotions` queda sin uso).
- Acceso del admin: enlace del negocio + PIN. Superadmin con PIN maestro.
- Google Wallet: **pospuesto** hasta que Google apruebe la cuenta. El botón está oculto.
- QR: afiche imprimible/PDF + PNG, descargable por el superadmin y por el admin del negocio.
- Varios negocios en un mismo teléfono: lista «Mis tarjetas».
- **Estrellas:** las suma el cliente escaneando el QR de estrellas del negocio (código fijo, regenerable) o tocando su etiqueta NFC. El admin solo escanea al cliente para canjear premios. Teléfono obligatorio y único por negocio. Voz «¡Gracias por tu compra!» al sumar. Diseño: `docs/superpowers/specs/2026-10-28-estrellas-por-visita-design.md`.
- Premios: solo se muestran al cliente cuando el admin los autoriza (`visible`).
- Al registrarse, el cliente ve una ventana para instalar la tarjeta como app (PWA). Android: botón «Descargar app»; iPhone: instrucciones (Compartir → Agregar a inicio); navegadores de WhatsApp/Instagram: pide abrir en Chrome.

## Base de datos
Para un proyecto nuevo, en Supabase → SQL Editor ejecutar **en orden**:
1. `supabase/schema.sql`
2. `supabase/multinegocio.sql`
3. `supabase/visitas.sql`
4. `supabase/premios.sql` (quita los planes: las estrellas se acumulan para los premios)

Los 4 están aplicados en `shrkfzuxpmwkyyqjzcmb` (el último `premios.sql`, con el reinicio a 0 al canjear, lo ejecutó el usuario el 28-oct).
El SQL lo ejecuta el usuario en el SQL Editor: Claude no tiene sesión de Supabase. Todos los archivos se pueden volver a ejecutar sin borrar datos.

Tablas: `businesses`, `customers` (con `business_id`), `visits`, `promotions` (= planes, con `business_id`), `rewards` (premios, con `business_id` y `visible`), `settings` (`super_pin_hash`, etc.).

Funciones RPC:
- **Cliente:** `app_business(slug)`, `app_register(biz, name, phone, plan)`, `app_get_card(token)`, `app_cards(tokens[])`, `app_choose_plan(token, plan)`, `app_checkin(token, biz, code, via)`, `app_checkin_phone(biz, code, phone, via)`, `app_set_phone(token, phone)`.
- **Admin (todas reciben `p_biz`, `p_pin`):** `admin_check`, `admin_overview`, `admin_customers`, `admin_add_stars`, `admin_assign_nfc`, `admin_lookup`, `admin_confirm_day`, `admin_use_bonus_day`, `admin_delete_customer`, `admin_promos`, `admin_save_promo`, `admin_delete_promo`, `admin_rewards`, `admin_save_reward`, `admin_set_reward_visible`, `admin_delete_reward`, `admin_save_settings`, `admin_visit_code`, `admin_regen_visit_code`, `admin_redeem_reward` (canjear premio → estrellas a 0).
- **Superadmin:** `super_check`, `super_businesses`, `super_save_business`, `super_set_pin`.

## Reglas de negocio
- Cada compra = 1 estrella (el cliente escanea el QR de estrellas o la etiqueta NFC). Varias por día; pausa de 3 min entre estrellas.
- Las estrellas se acumulan. La tarjeta muestra el avance al siguiente premio visible.
- En «Canjear» el admin escanea el QR del cliente y canjea un premio: el conteo de estrellas vuelve a 0 y la tarjeta sigue activa.
- Los días de regalo que quedaron de los planes se pueden seguir redimiendo.

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

## Historial del 28-oct-2026
1. Estrellas por QR/NFC del negocio (antes el admin escaneaba al cliente). Pestaña «QR de estrellas» con afiche, grabar NFC y regenerar código.
2. NFC en la ventana «Sumar estrella» (Android/Chrome); en iPhone se explica cómo acercar el teléfono.
3. Voz «¡Gracias por tu compra!».
4. Límite: primero 1 estrella cada 12 h → el usuario pidió varias por día → pausa de 3 min.
5. Se quitaron los planes (sumar fallaba con «El negocio no tiene planes activos»): estrellas acumuladas para premios; «Canjear» reinicia el conteo a 0.
6. NFC sin resolver: el usuario reportó que la etiqueta no hacía nada ni con la app cerrada. Se agregaron avisos (etiqueta vacía / no se pudo leer) y el botón «Probar etiqueta» en el admin. **Falta el resultado de «Probar etiqueta».**

## Pendientes
1. **NFC:** en un Android con Chrome, admin → QR de estrellas → «Probar etiqueta»; si está vacía, «Grabar etiqueta NFC» y volver a probar. Revisar con el mensaje que salga.
2. Probar en celulares el flujo completo: crear premio autorizado → sumar estrellas (QR, NFC, teléfono en iPhone) → pausa de 3 min → «Canjear» deja las estrellas en 0.
3. Cambiar el PIN del superadmin y el del negocio `principal`.
4. Terminar el DNS (3 registros A) y activar HTTPS en GitHub Pages. Grabar las etiquetas definitivas con `fidelizacion.shop`.
5. Riesgo aceptado: el QR de estrellas es fijo; con foto se podría sumar cada 3 min. Opciones si hace falta: pausa configurable por negocio o QR que cambia cada 30 s.
6. Google Wallet por negocio (cuando Google apruebe la cuenta).
7. Opcional: invitación por correo al admin del negocio; migrar datos del proyecto viejo; quitar del todo la tabla de planes.

## Cómo retomar
Abre Claude Code en la carpeta del proyecto y pide: «lee CONVERSACION.md y sigamos con …».
Local: `npm run dev` → http://localhost:5173 (se conecta a la base real de Supabase).
