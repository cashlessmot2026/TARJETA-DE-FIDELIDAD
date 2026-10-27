# Tarjeta de fidelidad

Tarjeta de estrellas con formato de tarjeta bancaria (gira: frente = estrellas, dorso = fechas de compra + QR).
React + Vite + Supabase.

## Rutas
- `#/super` superadmin: crea negocios (nombre, correo, logo, color, PIN del admin) y descarga su QR/afiche. PIN maestro inicial = el PIN de admin que había (cámbialo en Ajustes).
- `#/admin/<negocio>` panel del negocio (clientes, planes, premios, validar, código QR, ajustes). `#/admin` pide el enlace del negocio.
- `#/r/<negocio>` registro del cliente (es lo que abre el QR del afiche).
- `#/c/<token>` tarjeta del cliente · `#/` «Mis tarjetas» (una por negocio).

## Puesta en marcha
1. En Supabase → SQL Editor ejecuta `supabase/schema.sql` y luego `supabase/multinegocio.sql`.
2. `npm install && npm run dev`

El anon key solo puede llamar a las funciones RPC; las tablas tienen RLS sin políticas.

## Validación
- QR: pestaña Validar → Escanear QR (cámara).
- NFC: Chrome en Android (Web NFC). El cliente graba su etiqueta desde su tarjeta («Grabar en etiqueta NFC»).
- Hay un bloqueo de 20 s para no sumar dos veces la misma tarjeta.
