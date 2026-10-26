-- Reservas de entrevistas (proceso de selección de ventas · Tezontle 3D).

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 200),
  phone text check (char_length(phone) <= 40),
  notes text check (char_length(notes) <= 1000),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  meet_url text,
  calendar_event_id text,
  created_at timestamptz not null default now()
);

-- Un horario solo puede tener UNA reserva confirmada. Esto es lo que "desactiva" el
-- horario: si dos personas reservan al mismo tiempo, la segunda recibe error de la base.
-- Para liberar un horario: cambie status a 'cancelled' en el panel de Supabase.
create unique index bookings_one_per_slot
  on public.bookings (slot_start)
  where status = 'confirmed';

create index bookings_email_idx on public.bookings (lower(email));

-- RLS activo y sin políticas: el público NO puede leer nombres ni correos.
-- Solo la Edge Function (service role) escribe y lee la tabla.
alter table public.bookings enable row level security;
revoke all on public.bookings from anon, authenticated;

-- Lo único público: qué horarios ya están ocupados (sin datos personales).
create or replace function public.booked_slots(from_ts timestamptz, to_ts timestamptz)
returns setof timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select slot_start
  from public.bookings
  where status = 'confirmed'
    and slot_start >= from_ts
    and slot_start < to_ts;
$$;

revoke all on function public.booked_slots(timestamptz, timestamptz) from public;
grant execute on function public.booked_slots(timestamptz, timestamptz) to anon, authenticated;

-- La Edge Function usa service_role. Explícito por si el proyecto no expone tablas nuevas
-- automáticamente.
grant select, insert, update, delete on public.bookings to service_role;
