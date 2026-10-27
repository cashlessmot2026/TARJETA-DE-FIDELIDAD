# Tarjetas de fidelidad (gimnasio) · Resumen para continuar

Repo: https://github.com/cashlessmot2026/TARJETA-DE-FIDELIDAD (rama `main`, publica en GitHub Pages con Actions)
Supabase: proyecto `shrkfzuxpmwkyyqjzcmb` (antes `pirshjvxhxrqfqyajuxp`) · PIN admin/superadmin por defecto: `1234` (cámbialo)
Stack: Vite + React (`src/`), Supabase (RPC `security definer`, RLS sin políticas), Edge Function `wallet-pass` (Google Wallet).

## Qué hace la app hoy

**Cliente**
- Se registra (nombre, teléfono) y **elige plan**: 7 días (+1 regalo) o 14 días (+2 regalo).
- Tarjeta tipo crédito con giro 3D: frente = estrellas (meta = días del plan), dorso = compras + QR (`FID:<código>`).
- Fuegos artificiales al recibir una estrella.
- Al completar 7 días: aviso "¿seguir con el plan de 14 días?" (sí = conserva estrellas y completa 14; recibe solo la diferencia de regalo).
- Con día gratis disponible: tarjeta **roja que vibra** (rojo/amarillo) con "¡Ya tienes tu día gratis disponible!" y el QR en el frente.
- Botón Google Wallet (muestra "Estrellas: N" + QR; se actualiza cuando el cliente abre su tarjeta).

**Admin** (`#/admin`)
- **Validar**: escanear QR, leer NFC o escribir código. Si el cliente no tiene regalo, confirma el día pagado y suma 1 estrella automáticamente (fuegos artificiales). Si tiene regalo, ofrece "Redimir día gratis" o "Confirmar día pagado".
- Una confirmación por cliente cada 12 horas.
- **Clientes**: buscar, +/− estrellas, asignar/quitar NFC, **eliminar cliente**, ver plan.
- **Planes y premios**: crear/editar/ocultar/eliminar planes (título, descripción, días del plan, días de regalo).
- **Ajustes**: nombre del negocio, color, PIN.

## Reglas de negocio
- 1 día pagado = 1 estrella.
- Al llegar a la meta del plan se suman los días de regalo del plan (menos los ya regalados en el ciclo).
- Tras completar el plan, el siguiente día confirmado empieza un ciclo nuevo.
- Al redimir el **último** día gratis, se elimina la tarjeta y los datos del cliente.

## Funciones RPC (supabase/schema.sql)
Cliente: `app_register(name, phone, plan)`, `app_get_card`, `app_plans`, `app_choose_plan`.
Admin: `admin_check`, `admin_overview`, `admin_customers`, `admin_add_stars`, `admin_redeem`, `admin_assign_nfc`, `admin_lookup`, `admin_confirm_day`, `admin_register_payment` (ya sin uso en UI), `admin_use_bonus_day`, `admin_delete_customer`, `admin_promos`, `admin_save_promo`, `admin_delete_promo`, `admin_save_settings`.

## Estado
- Todo el esquema está aplicado en Supabase y publicado en GitHub (último commit: `341d6e0`).
- `wallet-pass` está desplegada con secretos (probada con token falso: responde 404 "Tarjeta no encontrada").

## Pendiente / ideas
- Probar con celulares reales: escaneo de QR (se agrandó y se le dio margen blanco), NFC, efecto de tarjeta roja y fuegos artificiales.
- Actualizar el pase de Google Wallet cuando el **admin** confirma el día (hoy solo se actualiza si el cliente abre su tarjeta) y mostrar "Día gratis disponible" en el pase.
- Decidir si la tarjeta se elimina al canjear el **primer** día gratis (hoy se elimina al canjear el último).
- Permitir al admin cambiar el plan de un cliente desde Clientes.
- Dos pestañas de Supabase → Secrets quedaron abiertas con cambios sin guardar: revisar.
- El campo "Estrellas visibles" de Ajustes ya no afecta la tarjeta (la meta sale del plan).

## Cómo retomar
Abre Claude Code en la carpeta del proyecto y pide: "lee CONVERSACION.md y sigamos con ...".
Para aplicar cambios de SQL: Supabase → SQL Editor → pegar el bloque nuevo de `supabase/schema.sql` y ejecutar.
