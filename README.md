# Tezontle 3D · Agenda de entrevistas (ventas)

Página tipo Calendly para el proceso de selección del equipo de ventas. El candidato elige
día y hora, la reserva se guarda en Supabase, el horario se desactiva para todos y se crea un
evento en Google Calendar con enlace de **Google Meet**; Google envía la invitación al
candidato y a Marcus.

Diseño, logo, colores y tipografías tomados de `tezontle-web` (sin modificarlo).

## Cómo funciona

```
Navegador (Astro, estático en Vercel)
  ├─ lee horarios ocupados ──▶ Supabase RPC booked_slots()  (solo fechas, sin datos personales)
  └─ reserva ───────────────▶ Edge Function "book"
                                 ├─ valida el horario (schedule.ts)
                                 ├─ inserta en bookings (índice único = 1 reserva por horario)
                                 ├─ crea evento + Meet en Google Calendar (invita a ambos)
                                 └─ opcional: correo con la marca vía Resend
```

- **Horarios:** `supabase/functions/_shared/schedule.ts` — única fuente de verdad (la usan la
  página y la función). Hora de Ciudad de México, espacios de 30 min, 21 días hacia adelante y
  2 h de anticipación mínima.
- **Doble reserva imposible:** índice único en la base. Si dos personas eligen el mismo
  horario a la vez, la segunda ve "Alguien acaba de reservar ese horario".
- **Una entrevista pendiente por correo.**
- La página se actualiza sola cada 30 s: lo que otro reserve aparece como "Reservado".

| Día | Espacios (CDMX) |
|---|---|
| Lunes | 09:10 · 16:30 · 17:00 |
| Martes | 11:30 · 16:30 · 17:00 |
| Miércoles | 10:40 · 11:10 · 11:40 · 13:00 · 13:30 · 16:30 · 17:00 |
| Jueves | 10:40 · 16:30 · 17:00 |
| Viernes | 10:40 · 16:30 · 17:00 |

## Puesta en marcha

### 1. Supabase

1. Cree un proyecto en [supabase.com](https://supabase.com) (región sugerida: `us-east-1` o la
   más cercana).
2. En **SQL Editor**, pegue y ejecute `supabase/migrations/20261026000000_bookings.sql`.
   (O con la CLI: `npx supabase link --project-ref <ref>` y `npx supabase db push`.)

### 2. Google Calendar + Meet (una sola vez)

Las llamadas se crean en el calendario de una cuenta de Google (Gmail o Workspace).

1. En [console.cloud.google.com](https://console.cloud.google.com) cree un proyecto.
2. **APIs y servicios → Biblioteca →** habilite **Google Calendar API**.
3. **Pantalla de consentimiento OAuth:** tipo *Externo*, agregue su correo como usuario de
   prueba y luego pulse **Publicar app** (en modo "Prueba" el token caduca a los 7 días).
4. **Credenciales → Crear credenciales → ID de cliente OAuth → App de escritorio.** Copie el
   *Client ID* y el *Client secret*.
5. En su computadora, dentro de este proyecto:
   ```bash
   npm install
   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run google-token
   ```
   Abra el enlace, entre con la cuenta de Google y acepte (si dice "app no verificada",
   *Configuración avanzada → Ir a…*). La terminal imprime `GOOGLE_REFRESH_TOKEN=...`.

### 3. Secretos y despliegue de la función

```bash
cp supabase/functions/.env.example supabase/functions/.env   # y llénelo
npx supabase login
npx supabase link --project-ref <ref-del-proyecto>
npx supabase secrets set --env-file supabase/functions/.env
npx supabase functions deploy book --no-verify-jwt
```

`MARCUS_EMAIL` es el correo al que llega cada reserva (actualmente `tezontle3d@outlook.com`).

### 4. Página en Vercel

1. Importe este repositorio en [vercel.com](https://vercel.com) (detecta Astro solo).
2. Variables de entorno (Supabase → Project Settings → API):
   - `PUBLIC_SUPABASE_URL`
   - `PUBLIC_SUPABASE_ANON_KEY` (la *publishable* o *anon*, **nunca** la service role)
3. Agregue el dominio final (ej. `agenda.tezontle3d.com`) a `ALLOWED_ORIGINS` y vuelva a
   correr `supabase secrets set`.

Sin estas variables la página corre en **modo demostración** (reservas solo en el navegador).

## Operación diaria

- **Ver reservas:** Supabase → Table Editor → `bookings`.
- **Liberar un horario** (cancelación): cambie `status` a `cancelled` en esa fila y borre el
  evento en Google Calendar (Google avisa al candidato).
- **Cambiar horarios:** edite `WEEKLY_SLOTS` en `supabase/functions/_shared/schedule.ts`,
  vuelva a desplegar la función (`npx supabase functions deploy book --no-verify-jwt`) y la
  página (push a GitHub).

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:4321
npm test         # pruebas de los horarios
```
