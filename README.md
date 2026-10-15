# Tarjeta de fidelidad

Tarjeta de estrellas con formato de tarjeta bancaria (gira: frente = estrellas, dorso = fechas de compra + QR).
React + Vite + Supabase.

## Rutas
- `#/` cliente: registro y tarjeta.
- `#/c/<token>` abre la tarjeta del cliente en otro dispositivo.
- `#/admin` panel oculto (no hay enlace en la interfaz). PIN inicial **1234**: cámbialo en Ajustes.

## Puesta en marcha
1. En Supabase → SQL Editor ejecuta `supabase/schema.sql`.
2. `npm install && npm run dev`

El anon key solo puede llamar a las funciones RPC; las tablas tienen RLS sin políticas.

## Validación
- QR: pestaña Validar → Escanear QR (cámara).
- NFC: Chrome en Android (Web NFC). El cliente graba su etiqueta desde su tarjeta («Grabar en etiqueta NFC»).
- Hay un bloqueo de 20 s para no sumar dos veces la misma tarjeta.
