-- Agenda de demos por vendedor (equipo de ventas · Tezontle 3D).

create extension if not exists btree_gist;

-- Quién administra el equipo (da de alta vendedores y ve todas las citas).
create table public.admins (
  email text primary key
);
insert into public.admins (email) values ('marcuspicazo@outlook.com');

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  name text not null check (char_length(name) between 2 and 80),
  email text not null unique check (email = lower(email)),
  title text not null default 'Asesor comercial' check (char_length(title) <= 80),
  whatsapp text check (char_length(whatsapp) <= 30),
  -- Horarios por día (1 = lunes … 7 = domingo), hora de CDMX:
  -- {"1": [["09:00","13:00"], ["16:00","18:00"]], "3": [["10:00","14:00"]]}
  availability jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.demo_bookings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete cascade,
  slot_start timestamptz not null,
  slot_end timestamptz not null check (slot_end > slot_start),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) between 5 and 200),
  phone text not null check (char_length(phone) between 7 and 40),
  company text not null check (char_length(company) between 2 and 120),
  city text not null check (char_length(city) between 2 and 80),
  units text not null check (units in ('Menos de 50', '50 a 150', 'Más de 150')),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  meet_url text,
  calendar_event_id text,
  created_at timestamptz not null default now(),
  -- Un vendedor no puede tener dos citas confirmadas que se encimen.
  constraint demo_no_overlap exclude using gist (
    seller_id with =,
    tstzrange(slot_start, slot_end) with &&
  ) where (status = 'confirmed')
);

create index demo_bookings_seller_start on public.demo_bookings (seller_id, slot_start);

-- ---------- Seguridad ----------

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where email = lower(auth.jwt() ->> 'email'));
$$;

alter table public.admins enable row level security;
alter table public.sellers enable row level security;
alter table public.demo_bookings enable row level security;

revoke all on public.admins, public.sellers, public.demo_bookings from anon, authenticated;
grant select on public.admins to authenticated;
grant select, insert, update on public.sellers to authenticated;
grant select on public.demo_bookings to authenticated;
grant select, insert, update, delete on public.admins, public.sellers, public.demo_bookings to service_role;

create policy "admins: ver si soy admin" on public.admins
  for select to authenticated using (email = lower(auth.jwt() ->> 'email'));

create policy "sellers: ver el propio o todos si admin" on public.sellers
  for select to authenticated using (email = lower(auth.jwt() ->> 'email') or public.is_admin());

create policy "sellers: editar el propio o todos si admin" on public.sellers
  for update to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.is_admin())
  with check (email = lower(auth.jwt() ->> 'email') or public.is_admin());

create policy "sellers: alta solo admin" on public.sellers
  for insert to authenticated with check (public.is_admin());

create policy "demos: ver las propias o todas si admin" on public.demo_bookings
  for select to authenticated using (
    public.is_admin()
    or seller_id in (select id from public.sellers where email = lower(auth.jwt() ->> 'email'))
  );

-- Un vendedor solo cambia su nombre, puesto, WhatsApp y horarios; correo, enlace y estado
-- solo los cambia el administrador.
create or replace function public.sellers_guard()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'authenticated' and not public.is_admin() then
    if new.email is distinct from old.email
      or new.slug is distinct from old.slug
      or new.active is distinct from old.active then
      raise exception 'Solo el administrador puede cambiar correo, enlace o estado';
    end if;
  end if;
  return new;
end;
$$;

create trigger sellers_guard before update on public.sellers
  for each row execute function public.sellers_guard();

-- ---------- Lo público (página de cada vendedor) ----------

create or replace function public.seller_public(p_slug text)
returns table (id uuid, slug text, name text, title text, availability jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select id, slug, name, title, availability
  from public.sellers
  where slug = lower(p_slug) and active;
$$;

-- Solo los rangos ocupados, sin datos del cliente.
create or replace function public.seller_busy(p_slug text, from_ts timestamptz, to_ts timestamptz)
returns table (slot_start timestamptz, slot_end timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.slot_start, b.slot_end
  from public.demo_bookings b
  join public.sellers s on s.id = b.seller_id
  where s.slug = lower(p_slug)
    and b.status = 'confirmed'
    and b.slot_end > from_ts
    and b.slot_start < to_ts;
$$;

revoke all on function public.seller_public(text), public.seller_busy(text, timestamptz, timestamptz) from public;
grant execute on function public.seller_public(text), public.seller_busy(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
