// Página pública de demos de un vendedor: lee su agenda en Supabase, pinta días y horarios
// (availability.ts) y reserva vía la Edge Function `book-demo`.
import {
  demoSlots,
  isoWeekday,
  normalizeAvailability,
  type Availability,
  type Busy,
  type DemoSlot,
} from '../../supabase/functions/_shared/availability';
import { cdmxDate, TIMEZONE } from '../../supabase/functions/_shared/schedule';

const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
const REFRESH_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// /demo/ana o, en local, /demo/?v=ana
const slug = (location.pathname.split('/')[2] || new URLSearchParams(location.search).get('v') || '').toLowerCase();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  sellerName: $('seller-name'),
  sellerTitle: $('seller-title'),
  sellerInitials: $('seller-initials'),
  notFound: $('not-found'),
  weekdayHead: $('weekday-head'),
  days: $('days'),
  month: $('days-month'),
  noSlots: $('no-slots'),
  slots: $('slots'),
  dayLabel: $('selected-day-label'),
  tzNote: $('tz-note'),
  picker: $('picker'),
  details: $('details'),
  done: $('done'),
  back: $<HTMLButtonElement>('back'),
  form: $<HTMLFormElement>('booking-form'),
  submit: $<HTMLButtonElement>('submit'),
  error: $('form-error'),
  summaryDate: $('summary-date'),
  summaryTime: $('summary-time'),
  summaryWith: $('summary-with'),
  doneWhen: $('done-when'),
  doneEmail: $('done-email'),
  doneMeet: $<HTMLAnchorElement>('done-meet'),
};

interface Seller {
  name: string;
  title: string;
  availability: Availability;
}

let seller: Seller | null = null;
let slots: DemoSlot[] = [];
let busy: Busy[] = [];
let selectedDate: string | null = null;
let selectedSlot: DemoSlot | null = null;

const fmt = (opts: Intl.DateTimeFormatOptions, tz = TIMEZONE) => new Intl.DateTimeFormat('es-MX', { timeZone: tz, ...opts });
const longDate = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const shortTime = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });
const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localTime = fmt({ hour: '2-digit', minute: '2-digit', hour12: false }, userTz);
const capitalize = (s: string) => s.replace(/^./, (c) => c.toUpperCase());
const dateAtNoon = (ymd: string) => new Date(`${ymd}T12:00:00-06:00`);

const isTaken = (s: DemoSlot) => {
  const a = Date.parse(s.start);
  const b = Date.parse(s.end);
  return busy.some((x) => a < Date.parse(x.slot_end) && b > Date.parse(x.slot_start));
};

// ---------- Datos ----------

async function rpc<T>(fn: string, body: unknown): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn} ${res.status}`);
  return res.json();
}

async function loadSeller(): Promise<Seller | null> {
  const rows = await rpc<Seller[]>('seller_public', { p_slug: slug });
  return rows[0] ?? null;
}

async function refresh() {
  if (!seller) return;
  // Todos los espacios del vendedor; los ocupados se muestran como "Reservado".
  slots = demoSlots(seller.availability, []);
  try {
    if (slots.length) busy = await rpc<Busy[]>('seller_busy', { p_slug: slug, from_ts: slots[0].start, to_ts: slots.at(-1)!.end });
  } catch (err) {
    console.error(err);
  }
  render();
}

// ---------- Render ----------

function renderDays() {
  const weekdays = new Set(Object.keys(normalizeAvailability(seller!.availability)).map(Number));
  // Lunes a viernes siempre; sábado y domingo solo si el vendedor atiende esos días.
  const cols = [1, 2, 3, 4, 5, ...[6, 7].filter((d) => weekdays.has(d))];
  const names = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const gridCols = `repeat(${cols.length}, minmax(0, 1fr))`;
  els.weekdayHead.style.gridTemplateColumns = gridCols;
  els.days.style.gridTemplateColumns = gridCols;
  els.weekdayHead.innerHTML = cols.map((d) => `<span>${names[d]}</span>`).join('');

  const byDate = new Map<string, DemoSlot[]>();
  for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  const today = cdmxDate(new Date());
  const monday = dateAtNoon(today.date);
  monday.setUTCDate(monday.getUTCDate() - (isoWeekday(today.weekday) - 1));
  const lastDate = slots.at(-1)?.date ?? today.date;
  const weeks = Math.ceil((dateAtNoon(lastDate).getTime() - monday.getTime()) / (7 * DAY_MS) + 1 / 7);

  const cells: string[] = [];
  const months = new Set<string>();
  for (let i = 0; i < weeks * 7; i++) {
    const { date, weekday } = cdmxDate(new Date(monday.getTime() + i * DAY_MS));
    if (!cols.includes(isoWeekday(weekday))) continue;
    const daySlots = byDate.get(date) ?? [];
    const free = daySlots.filter((s) => !isTaken(s)).length;
    const dayNum = Number(date.slice(8));
    const label = longDate.format(dateAtNoon(date));
    if (daySlots.length) months.add(monthYear.format(dateAtNoon(date)));

    if (daySlots.length === 0) {
      cells.push(`<div class="day day-empty" aria-hidden="true">${dayNum}</div>`);
    } else if (free === 0) {
      cells.push(`<button type="button" class="day day-full" disabled aria-label="${label}, sin horarios libres">${dayNum}</button>`);
    } else {
      const sel = date === selectedDate;
      cells.push(
        `<button type="button" data-date="${date}" class="day day-available${sel ? ' day-selected' : ''}" aria-pressed="${sel}" aria-label="${label}, ${free} ${free === 1 ? 'horario libre' : 'horarios libres'}">${dayNum}</button>`,
      );
    }
  }
  els.days.innerHTML = cells.join('');
  els.month.textContent = capitalize([...months].join(' – '));
  els.noSlots.hidden = slots.some((s) => !isTaken(s));
}

function renderSlots() {
  if (!selectedDate) {
    els.dayLabel.textContent = 'Primero elija un día.';
    els.slots.innerHTML = '';
    els.tzNote.hidden = true;
    return;
  }
  els.dayLabel.textContent = capitalize(longDate.format(dateAtNoon(selectedDate)));
  let anyLocal = false;
  els.slots.innerHTML = slots
    .filter((s) => s.date === selectedDate)
    .map((s) => {
      const taken = isTaken(s);
      const range = `${shortTime.format(new Date(s.start))} – ${shortTime.format(new Date(s.end))}`;
      const local = localTime.format(new Date(s.start)) !== shortTime.format(new Date(s.start));
      anyLocal ||= local;
      const right = taken
        ? '<span class="text-xs font-semibold uppercase tracking-wide">Reservado</span>'
        : local
          ? `<span class="text-xs font-medium text-tinta-suave">${localTime.format(new Date(s.start))} su hora</span>`
          : `<svg class="h-3 w-4 text-piedra" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 1l5 5-5 5M15 6H1" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
      return `<button type="button" class="slot fade-in" data-slot="${s.start}" ${taken ? 'disabled aria-disabled="true"' : ''}>
          <span class="slot-time">${range}</span>${right}
        </button>`;
    })
    .join('');
  els.tzNote.hidden = !anyLocal;
  els.tzNote.textContent = anyLocal ? `Horarios en hora de Ciudad de México. Su zona horaria: ${userTz}.` : '';
}

function render() {
  if (selectedDate && !slots.some((s) => s.date === selectedDate && !isTaken(s))) selectedDate = null;
  renderDays();
  renderSlots();
}

function show(view: 'picker' | 'details' | 'done') {
  els.picker.hidden = view !== 'picker';
  els.details.hidden = view !== 'details';
  els.done.hidden = view !== 'done';
  const target = view === 'picker' ? els.picker : view === 'details' ? els.details : els.done;
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

const ERRORS: Record<string, string> = {
  slot_taken: 'Alguien acaba de reservar ese horario. Por favor elija otro.',
  invalid_email: 'Revise su correo electrónico.',
  invalid_name: 'Escriba su nombre completo.',
  invalid_phone: 'Revise su número de WhatsApp.',
  invalid_company: 'Escriba el nombre de la desarrolladora y la ciudad del proyecto.',
  invalid_units: 'Elija el número de departamentos.',
  seller_not_found: 'Esta agenda ya no está disponible.',
  calendar_error: 'No pudimos crear la llamada en este momento. Intente de nuevo en unos minutos.',
  network: 'Sin conexión. Revise su internet e intente de nuevo.',
};

function showError(code: string | null) {
  els.error.hidden = !code;
  els.error.textContent = code ? (ERRORS[code] ?? 'Algo salió mal. Intente de nuevo.') : '';
}

// ---------- Eventos ----------

els.days.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-date]');
  if (!btn) return;
  selectedDate = btn.dataset.date!;
  renderDays();
  renderSlots();
  if (window.innerWidth < 1024) els.slots.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

els.slots.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-slot]');
  if (!btn || btn.disabled) return;
  selectedSlot = slots.find((s) => s.start === btn.dataset.slot) ?? null;
  if (!selectedSlot || !seller) return;
  els.summaryDate.textContent = longDate.format(new Date(selectedSlot.start));
  els.summaryTime.textContent = `${shortTime.format(new Date(selectedSlot.start))} – ${shortTime.format(new Date(selectedSlot.end))} h (CDMX)`;
  els.summaryWith.textContent = `Demo por Google Meet con ${seller.name}`;
  showError(null);
  show('details');
  setTimeout(() => $<HTMLInputElement>('f-name').focus({ preventScroll: true }), 400);
});

els.back.addEventListener('click', () => {
  selectedSlot = null;
  show('picker');
});

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!selectedSlot) return show('picker');
  if (!els.form.checkValidity()) {
    els.form.reportValidity();
    return;
  }
  const data = Object.fromEntries(new FormData(els.form)) as Record<string, string>;
  els.submit.disabled = true;
  els.submit.textContent = 'Agendando…';
  showError(null);

  let result: { ok?: boolean; meetUrl?: string; error?: string };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/book-demo`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, seller: slug, slot: selectedSlot.start }),
    });
    result = await res.json().catch(() => ({ error: 'server_error' }));
  } catch {
    result = { error: 'network' };
  }

  els.submit.disabled = false;
  els.submit.textContent = 'Confirmar demo';

  if (!result.ok) {
    showError(result.error ?? 'server_error');
    if (result.error === 'slot_taken') {
      await refresh();
      setTimeout(() => show('picker'), 1800);
    }
    return;
  }

  busy.push({ slot_start: selectedSlot.start, slot_end: selectedSlot.end });
  els.doneWhen.textContent = `${longDate.format(new Date(selectedSlot.start))} · ${shortTime.format(new Date(selectedSlot.start))} h (CDMX)`;
  els.doneEmail.textContent = data.email;
  els.doneMeet.href = result.meetUrl ?? '#';
  els.form.reset();
  show('done');
  render();
});

setInterval(() => document.visibilityState === 'visible' && els.details.hidden && refresh(), REFRESH_MS);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

function notFound() {
  els.picker.hidden = true;
  els.notFound.hidden = false;
  els.sellerName.classList.remove('skeleton', 'h-4', 'w-32');
  els.sellerName.textContent = 'Tezontle 3D';
}

(async () => {
  if (!slug || !SUPABASE_URL || !SUPABASE_KEY) return notFound();
  try {
    seller = await loadSeller();
  } catch (err) {
    console.error(err);
  }
  if (!seller) return notFound();
  els.sellerName.classList.remove('skeleton', 'h-4', 'w-32');
  els.sellerName.textContent = seller.name;
  els.sellerTitle.textContent = `${seller.title} · Tezontle 3D`;
  els.sellerInitials.textContent = seller.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  document.title = `Agende una demo con ${seller.name} · Tezontle 3D`;
  await refresh();
})();
