# Estrellas por visita: el cliente escanea el código del negocio

Fecha: 28 de octubre de 2026 · Aprobado en la conversación.

## Objetivo
Hoy el admin escanea el QR/NFC del cliente para darle la estrella. Ahora **el cliente** escanea un código del negocio
(QR de visita en el panel del admin, o una etiqueta NFC del negocio) y la estrella solo se suma si el servidor valida
que ese código es el vigente del negocio. El QR de registro (`#/r/<negocio>`) no cambia.

## Decisiones
- **Código de visita fijo por negocio** (`businesses.visit_code`, 10 caracteres). El admin lo puede **regenerar**:
  el QR anterior y las etiquetas viejas dejan de servir.
- QR y etiqueta NFC llevan el mismo enlace: `#/v/<negocio>/<código>` (la etiqueta agrega `/nfc` para las estadísticas).
- **Dos formas de escanear:**
  - Botón «Sumar estrella» dentro de la tarjeta (cámara dentro de la app; funciona en Android e iPhone).
  - Enlace externo (cámara del teléfono o etiqueta NFC). Si el navegador tiene la tarjeta de ese negocio, suma al instante;
    si no (iPhone con la app instalada), pide el **teléfono registrado**; si no hay tarjeta con ese teléfono, ofrece registrarse.
- **Teléfono obligatorio** al registrarse y único por negocio (se comparan los últimos 10 dígitos).
  A quien no tenga teléfono se le pide al abrir su tarjeta.
- Reglas iguales: 1 estrella cada 12 h por cliente, días de regalo al completar el plan.
- Admin: pestaña «QR de estrellas» (afiche, PNG, copiar enlace, grabar etiqueta NFC, regenerar).
  «Validar» queda como «Redimir» (solo día gratis). Se quita «Asignar NFC» a clientes.
  En Clientes, «+» suma una estrella manual con la lógica del plan (sin el límite de 12 h).
- Superadmin: puede ver/descargar el QR de estrellas de cada negocio.

## Base de datos (`supabase/visitas.sql`)
- `businesses.visit_code` + `_new_visit_code()`.
- `_phone(text)` normaliza a dígitos; `_checkin(customer, via, strict)` concentra la lógica de sumar el día.
- Cliente: `app_checkin(token, biz, code, via)`, `app_checkin_phone(biz, code, phone, via)` (devuelve `null` si no hay
  tarjeta con ese teléfono; nunca devuelve el token), `app_set_phone(token, phone)`.
- Admin: `admin_visit_code(biz, pin)`, `admin_regen_visit_code(biz, pin)`. `admin_confirm_day` usa `_checkin`.
- `app_register` exige teléfono único; `app_get_card` devuelve `has_phone`; `super_businesses` devuelve `visit_code`.

## Riesgo aceptado
Un código fijo se puede fotografiar o guardar. Se mitiga con el límite de 12 h y el botón «Regenerar».
