// Panel del equipo: sesión con Supabase Auth (correo + contraseña), horarios y perfil del
// vendedor (tabla sellers, protegida con RLS), demos y acciones de servidor vía `team`.
import { createClient, type Session } from '@supabase/supabase-js';
import { normalizeAvailability, type Availability } from '../../supabase/functions/_shared/availability';
import { TIMEZONE } from '../../supabase/functions/_shared/schedule';

const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL as string).replace(/\/$/, '');
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface Seller {
  id: string;
  slug: string;
  name: string;
  email: string;
  title: string;
  whatsapp: string | null;
  availability: Availability;
  active: boolean;
}

interface Booking {
  id: string;
  seller_id: string;
  slot_start: string;
  slot_end: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  city: string;
  units: string;
  meet_url: string | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-MX', { timeZone: TIMEZONE, ...o });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const timeFmt = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const linkFor = (slug: string) => `${location.origin}/demo/${slug}`;
const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const TIMES = Array.from({ length: 33 }, (_, i) => {
  const m = 6 * 60 + i * 30; // 06:00 a 22:00
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

let session: Session | null = null;
let me: Seller | null = null;
let isAdmin = false;
let sellers: Seller[] = [];
let draft: Availability = {};

// ---------- Utilidades ----------

function status(id: string, text: string, ok = true) {
  const el = $(id);
  el.textContent = text;
  el.classList.toggle('text-rojo-tezontle', !ok);
  el.classList.toggle('text-tinta-suave', ok);
}

async function copy(text: string, button: HTMLButtonElement) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = 'Copiado';
  } catch {
    button.textContent = 'No se pudo copiar';
  }
  setTimeout(() => (button.textContent = original), 1600);
}

async function team(action: string, payload: Record<string, unknown>) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/team`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json().catch(() => ({ error: 'server_error' }));
}

function generatePassword() {
  const words = ['tezontle', 'piedra', 'torre', 'maqueta', 'preventa', 'latón'];
  const n = crypto.getRandomValues(new Uint32Array(2));
  return `${words[n[0] % words.length].replace('ó', 'o')}-${String(1000 + (n[1] % 9000))}`;
}

function waLink(phone: string) {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = `52${digits}`;
  return `https://wa.me/${digits}`;
}

// ---------- Tabs ----------

function setupTabs() {
  const tabs: [string, string][] = [];
  if (me) tabs.push(['citas', 'Mis demos'], ['horarios', 'Mis horarios'], ['perfil', 'Mi perfil']);
  else tabs.push(['perfil', 'Mi cuenta']);
  if (isAdmin) tabs.push(['equipo', 'Equipo'], ['todas', 'Todas las demos']);
  $('tabs').innerHTML = tabs
    .map(
      ([id, label]) =>
        `<button type="button" role="tab" data-tab="${id}" class="shrink-0 rounded-full px-4 py-2 whitespace-nowrap transition-colors aria-selected:bg-grafito aria-selected:text-cal">${label}</button>`,
    )
    .join('');
  const initial = tabs.find(([id]) => id === location.hash.slice(1))?.[0] ?? tabs[0][0];
  selectTab(initial);
}

function selectTab(id: string) {
  for (const btn of $('tabs').querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.tab === id));
  }
  for (const t of ['citas', 'horarios', 'perfil', 'equipo', 'todas']) $(`tab-${t}`).hidden = t !== id;
  history.replaceState(null, '', `#${id}`);
}

$('tabs').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
  if (btn) selectTab(btn.dataset.tab!);
});

// ---------- Demos ----------

function bookingCard(b: Booking, sellerName?: string) {
  const start = new Date(b.slot_start);
  return `<article class="grid gap-4 rounded-2xl bg-arena p-4 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-5" data-booking="${b.id}">
    <div class="flex items-center gap-3 sm:block sm:w-28">
      <p class="text-xs font-semibold tracking-wide text-tinta-suave uppercase">${esc(dayFmt.format(start))}</p>
      <p class="font-display text-2xl tabular-nums">${timeFmt.format(start)}</p>
    </div>
    <div class="min-w-0">
      <p class="font-display text-xl">${esc(b.company)}${sellerName ? ` <span class="font-sans text-sm text-tinta-suave">· con ${esc(sellerName)}</span>` : ''}</p>
      <p class="mt-1 text-sm text-tinta-suave">${esc(b.name)} · ${esc(b.city)} · ${esc(b.units)} deptos.</p>
      <p class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm font-semibold">
        <a class="underline underline-offset-4" href="${waLink(b.phone)}" target="_blank" rel="noopener">WhatsApp ${esc(b.phone)}</a>
        <span class="font-normal text-tinta-suave select-all">${esc(b.email)}</span>
      </p>
    </div>
    <div class="flex flex-wrap gap-2 sm:justify-end">
      ${b.meet_url ? `<a href="${esc(b.meet_url)}" target="_blank" rel="noopener" class="btn btn-primary min-h-10 py-1.5 text-sm">Meet</a>` : ''}
      <button type="button" data-cancel="${b.id}" class="btn btn-ghost min-h-10 py-1.5 text-sm">Cancelar</button>
    </div>
    <div data-confirm="${b.id}" hidden class="flex flex-wrap items-center gap-3 rounded-xl bg-cal p-3 text-sm sm:col-span-3">
      <span>¿Cancelar esta demo? Google le avisará al cliente.</span>
      <button type="button" data-cancel-yes="${b.id}" class="btn min-h-9 bg-rojo-tezontle py-1 text-sm text-cal">Sí, cancelar</button>
      <button type="button" data-cancel-no="${b.id}" class="btn btn-ghost min-h-9 py-1 text-sm">No</button>
    </div>
  </article>`;
}

const emptyState = (text: string) => `<p class="rounded-2xl bg-arena px-5 py-6 text-center text-tinta-suave">${text}</p>`;

async function loadBookings() {
  const { data, error } = await supabase
    .from('demo_bookings')
    .select('id, seller_id, slot_start, slot_end, name, email, phone, company, city, units, meet_url')
    .eq('status', 'confirmed')
    .gte('slot_end', new Date().toISOString())
    .order('slot_start');
  if (error) return console.error(error);
  const bookings = (data ?? []) as Booking[];
  if (me) {
    const mine = bookings.filter((b) => b.seller_id === me!.id);
    $('my-bookings').innerHTML = mine.length
      ? mine.map((b) => bookingCard(b)).join('')
      : emptyState('Todavía no tiene demos agendadas. Comparta su enlace con sus clientes.');
  }
  if (isAdmin) {
    const names = new Map(sellers.map((s) => [s.id, s.name]));
    $('all-bookings').innerHTML = bookings.length
      ? bookings.map((b) => bookingCard(b, names.get(b.seller_id))).join('')
      : emptyState('No hay demos próximas en el equipo.');
  }
}

document.addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const ask = t.closest<HTMLElement>('[data-cancel]')?.dataset.cancel;
  const no = t.closest<HTMLElement>('[data-cancel-no]')?.dataset.cancelNo;
  const yes = t.closest<HTMLButtonElement>('[data-cancel-yes]');
  if (ask || no) {
    document.querySelectorAll<HTMLElement>(`[data-confirm="${ask ?? no}"]`).forEach((el) => (el.hidden = !!no));
  }
  if (yes) {
    yes.disabled = true;
    yes.textContent = 'Cancelando…';
    const result = await team('cancel_booking', { booking_id: yes.dataset.cancelYes });
    if (!result.ok) {
      yes.disabled = false;
      yes.textContent = 'No se pudo, reintentar';
      return;
    }
    await loadBookings();
  }
});

// ---------- Horarios ----------

function renderAvailability() {
  $('availability').innerHTML = [1, 2, 3, 4, 5, 6, 7]
    .map((d) => {
      const ranges = draft[String(d)] ?? [];
      const on = ranges.length > 0;
      const options = (selected: string) =>
        TIMES.map((t) => `<option value="${t}"${t === selected ? ' selected' : ''}>${t}</option>`).join('');
      return `<div class="grid gap-3 py-4 sm:grid-cols-[10rem_1fr] sm:items-start">
        <label class="flex min-h-11 cursor-pointer items-center gap-3 font-semibold">
          <input type="checkbox" data-day-toggle="${d}" ${on ? 'checked' : ''} class="h-5 w-5 accent-[var(--color-grafito)]" />
          ${DAY_NAMES[d]}
        </label>
        <div class="space-y-2">
          ${
            on
              ? ranges
                  .map(
                    ([from, to], i) => `<div class="flex flex-wrap items-center gap-2">
                <select data-day="${d}" data-i="${i}" data-edge="0" class="field w-auto min-w-0 py-2" aria-label="${DAY_NAMES[d]} desde">${options(from)}</select>
                <span class="text-tinta-suave">a</span>
                <select data-day="${d}" data-i="${i}" data-edge="1" class="field w-auto min-w-0 py-2" aria-label="${DAY_NAMES[d]} hasta">${options(to)}</select>
                <button type="button" data-remove="${d}:${i}" class="grid h-10 w-10 place-items-center rounded-full text-tinta-suave hover:bg-arena hover:text-grafito" aria-label="Quitar horario">×</button>
              </div>`,
                  )
                  .join('') +
                `<button type="button" data-add="${d}" class="text-sm font-semibold text-tinta-suave underline underline-offset-4 hover:text-grafito">+ Agregar otro horario</button>`
              : '<p class="flex min-h-11 items-center text-sm text-piedra">No disponible</p>'
          }
        </div>
      </div>`;
    })
    .join('');
}

$('availability').addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  if (el instanceof HTMLInputElement && el.dataset.dayToggle) {
    const d = el.dataset.dayToggle;
    if (el.checked) draft[d] = [['09:00', '14:00']];
    else delete draft[d];
    renderAvailability();
  } else if (el instanceof HTMLSelectElement && el.dataset.day) {
    draft[el.dataset.day][Number(el.dataset.i)][Number(el.dataset.edge)] = el.value;
  }
  status('availability-status', 'Cambios sin guardar');
});

$('availability').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const add = t.closest<HTMLElement>('[data-add]')?.dataset.add;
  const remove = t.closest<HTMLElement>('[data-remove]')?.dataset.remove;
  if (add) {
    const last = draft[add].at(-1)?.[1] ?? '09:00';
    const startIdx = Math.min(TIMES.indexOf(last) + 2, TIMES.length - 3);
    draft[add].push([TIMES[startIdx], TIMES[startIdx + 2]]);
  } else if (remove) {
    const [d, i] = remove.split(':');
    draft[d].splice(Number(i), 1);
    if (!draft[d].length) delete draft[d];
  } else return;
  renderAvailability();
  status('availability-status', 'Cambios sin guardar');
});

$('save-availability').addEventListener('click', async () => {
  if (!me) return;
  const invalid = Object.entries(draft).find(([, ranges]) => ranges.some(([a, b]) => b <= a));
  if (invalid) return status('availability-status', `Revise el ${DAY_NAMES[Number(invalid[0])].toLowerCase()}: la hora final debe ser después de la inicial.`, false);
  const short = Object.entries(draft).find(([, ranges]) => ranges.some(([a, b]) => TIMES.indexOf(b) - TIMES.indexOf(a) < 2));
  if (short) return status('availability-status', `Cada horario debe durar al menos 1 hora para que quepa una demo de 45 min (${DAY_NAMES[Number(short[0])]}).`, false);
  const availability = normalizeAvailability(draft);
  status('availability-status', 'Guardando…');
  const { error } = await supabase.from('sellers').update({ availability }).eq('id', me.id);
  if (error) return status('availability-status', 'No se pudo guardar. Intente de nuevo.', false);
  me.availability = availability;
  draft = structuredClone(availability);
  renderAvailability();
  status('availability-status', 'Guardado. Sus clientes ya ven estos horarios.');
});

// ---------- Perfil ----------

$<HTMLFormElement>('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!me) return status('profile-status', 'Su usuario no tiene perfil de vendedor.', false);
  const f = Object.fromEntries(new FormData(e.target as HTMLFormElement)) as Record<string, string>;
  const update = { name: f.name.trim(), title: f.title.trim(), whatsapp: f.whatsapp.trim() || null };
  const { error } = await supabase.from('sellers').update(update).eq('id', me.id);
  if (error) return status('profile-status', 'No se pudo guardar.', false);
  Object.assign(me, update);
  $('hello').textContent = `Hola, ${me.name.split(' ')[0]}.`;
  status('profile-status', 'Guardado.');
});

$<HTMLFormElement>('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  const { password, confirm } = Object.fromEntries(new FormData(form)) as Record<string, string>;
  if (password !== confirm) return status('password-status', 'Las contraseñas no coinciden.', false);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return status('password-status', 'No se pudo cambiar. Use al menos 8 caracteres.', false);
  form.reset();
  status('password-status', 'Contraseña cambiada.');
});

// ---------- Administración ----------

function renderSellers() {
  $('sellers').innerHTML = sellers.length
    ? sellers
        .map(
          (s) => `<article class="rounded-2xl bg-arena p-4 sm:p-5">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="font-display text-xl">${esc(s.name)}</p>
          <p class="text-sm text-tinta-suave">${esc(s.title)} · <span class="select-all">${esc(s.email)}</span></p>
          <p class="mt-1 text-sm break-all"><a class="underline underline-offset-4" href="${linkFor(s.slug)}" target="_blank" rel="noopener">${linkFor(s.slug).replace(/^https?:\/\//, '')}</a></p>
        </div>
        <span class="rounded-full px-3 py-1 text-xs font-semibold ${s.active ? 'bg-grafito text-cal' : 'bg-cal text-tinta-suave'}">${s.active ? 'Activo' : 'Pausado'}</span>
      </div>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" data-copy-link="${s.slug}" class="btn btn-ghost min-h-9 py-1 text-sm">Copiar enlace</button>
        <button type="button" data-toggle-active="${s.id}" class="btn btn-ghost min-h-9 py-1 text-sm">${s.active ? 'Pausar agenda' : 'Activar agenda'}</button>
        <button type="button" data-reset-password="${s.id}" class="btn btn-ghost min-h-9 py-1 text-sm">Nueva contraseña</button>
      </div>
      <p data-seller-note="${s.id}" class="mt-2 text-sm text-tinta-suave" aria-live="polite"></p>
    </article>`,
        )
        .join('')
    : emptyState('Aún no hay vendedores. Dé de alta al primero con el formulario.');
}

async function loadSellers() {
  const { data } = await supabase.from('sellers').select('*').order('created_at');
  sellers = (data ?? []) as Seller[];
  if (isAdmin) renderSellers();
}

$('sellers').addEventListener('click', async (e) => {
  const t = e.target as HTMLElement;
  const copyBtn = t.closest<HTMLButtonElement>('[data-copy-link]');
  const toggle = t.closest<HTMLButtonElement>('[data-toggle-active]');
  const reset = t.closest<HTMLButtonElement>('[data-reset-password]');
  if (copyBtn) return copy(linkFor(copyBtn.dataset.copyLink!), copyBtn);
  if (toggle) {
    const s = sellers.find((x) => x.id === toggle.dataset.toggleActive)!;
    await supabase.from('sellers').update({ active: !s.active }).eq('id', s.id);
    await loadSellers();
  }
  if (reset) {
    const id = reset.dataset.resetPassword!;
    const password = generatePassword();
    reset.disabled = true;
    const result = await team('set_password', { seller_id: id, password });
    reset.disabled = false;
    const note = document.querySelector<HTMLElement>(`[data-seller-note="${id}"]`)!;
    note.innerHTML = result.ok
      ? `Nueva contraseña: <strong class="font-mono text-grafito select-all">${esc(password)}</strong>`
      : 'No se pudo cambiar la contraseña.';
  }
});

const slugify = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 2)
    .join('-');

let slugEdited = false;
$('s-slug').addEventListener('input', () => (slugEdited = true));
$('s-name').addEventListener('input', (e) => {
  if (!slugEdited) $<HTMLInputElement>('s-slug').value = slugify((e.target as HTMLInputElement).value);
});
$('gen-password').addEventListener('click', () => ($<HTMLInputElement>('s-password').value = generatePassword()));

const SELLER_ERRORS: Record<string, string> = {
  slug_taken: 'Ese enlace ya lo usa otro vendedor.',
  email_taken: 'Ese correo ya está dado de alta.',
  invalid_slug: 'El enlace solo puede llevar minúsculas, números y guiones.',
  invalid_email: 'Revise el correo.',
  weak_password: 'La contraseña debe tener al menos 8 caracteres.',
};

$<HTMLFormElement>('seller-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target as HTMLFormElement;
  if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
  const err = $('seller-error');
  err.hidden = true;
  $<HTMLButtonElement>('seller-submit').disabled = true;
  const result = await team('create_seller', data);
  $<HTMLButtonElement>('seller-submit').disabled = false;
  if (!result.ok) {
    err.textContent = SELLER_ERRORS[result.error] ?? 'No se pudo dar de alta. Intente de nuevo.';
    err.hidden = false;
    return;
  }
  const first = data.name.trim().split(' ')[0];
  $('seller-message').textContent = [
    `Hola ${first}, ya tienes tu agenda de demos de Tezontle 3D.`,
    '',
    `Tu enlace para clientes: ${linkFor(data.slug)}`,
    '',
    `Panel para marcar tus horarios y ver tus citas: ${location.origin}/equipo`,
    `Correo: ${data.email.trim().toLowerCase()}`,
    result.existingUser ? 'Contraseña: la misma que ya usas.' : `Contraseña: ${data.password}`,
    '',
    'Entra al panel, marca tus horarios en "Mis horarios" y guarda. Puedes cambiar tu contraseña en "Mi perfil".',
  ].join('\n');
  $('seller-created').hidden = false;
  form.reset();
  slugEdited = false;
  $<HTMLInputElement>('s-title').value = 'Asesor comercial';
  $<HTMLInputElement>('s-password').value = generatePassword();
  await loadSellers();
  // Si el administrador se dio de alta a sí mismo, recarga su panel de vendedor.
  if (data.email.trim().toLowerCase() === session?.user.email?.toLowerCase()) await boot();
});

$('copy-message').addEventListener('click', (e) => copy($('seller-message').textContent ?? '', e.currentTarget as HTMLButtonElement));
$('copy-link').addEventListener('click', (e) => me && copy(linkFor(me.slug), e.currentTarget as HTMLButtonElement));

// ---------- Sesión ----------

async function boot() {
  const email = session!.user.email!.toLowerCase();
  const [{ data: adminRow }, { data: mine }] = await Promise.all([
    supabase.from('admins').select('email').eq('email', email).maybeSingle(),
    supabase.from('sellers').select('*').eq('email', email).maybeSingle(),
  ]);
  isAdmin = !!adminRow;
  me = (mine as Seller) ?? null;

  $('login').hidden = true;
  $('app').hidden = false;
  $('logout').hidden = false;
  $('role-label').textContent = isAdmin ? 'Administrador · Equipo de ventas' : 'Equipo de ventas';
  $('hello').textContent = `Hola, ${(me?.name ?? 'Marcus').split(' ')[0]}.`;
  $('no-access').hidden = !!me || isAdmin;
  $('link-card').hidden = !me;
  $('profile-form').hidden = !me;

  if (me) {
    $('my-link').textContent = linkFor(me.slug).replace(/^https?:\/\//, '');
    $<HTMLAnchorElement>('open-link').href = linkFor(me.slug);
    $<HTMLInputElement>('p-name').value = me.name;
    $<HTMLInputElement>('p-title').value = me.title;
    $<HTMLInputElement>('p-whatsapp').value = me.whatsapp ?? '';
    draft = structuredClone(normalizeAvailability(me.availability));
    renderAvailability();
  }
  if (isAdmin) {
    $<HTMLInputElement>('s-password').value = generatePassword();
    await loadSellers();
  }
  setupTabs();
  await loadBookings();
}

function showLogin() {
  $('login').hidden = false;
  $('app').hidden = true;
  $('logout').hidden = true;
}

$<HTMLFormElement>('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { email, password } = Object.fromEntries(new FormData(e.target as HTMLFormElement)) as Record<string, string>;
  const err = $('login-error');
  err.hidden = true;
  $<HTMLButtonElement>('login-submit').disabled = true;
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  $<HTMLButtonElement>('login-submit').disabled = false;
  if (error || !data.session) {
    err.textContent = 'Correo o contraseña incorrectos.';
    err.hidden = false;
    return;
  }
  session = data.session;
  await boot();
});

$('logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  session = null;
  history.replaceState(null, '', location.pathname);
  showLogin();
});

supabase.auth.onAuthStateChange((_event, s) => (session = s));

(async () => {
  const { data } = await supabase.auth.getSession();
  session = data.session;
  if (session) await boot();
  else showLogin();
})();
