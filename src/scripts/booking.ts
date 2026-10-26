// Lógica de la página de reservas: pinta días y horarios (schedule.ts), consulta en Supabase
// cuáles ya están ocupados y reserva vía la Edge Function `book`.
import { cdmxDate, TIMEZONE, upcomingSlots, type Slot } from '../../supabase/functions/_shared/schedule';

const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined)?.replace(/\/$/, '');
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;
// Sin Supabase configurado la página funciona en modo demostración (solo este navegador).
const DEMO = !SUPABASE_URL || !SUPABASE_KEY;
const DEMO_KEY = 'tezontle-agenda-demo';
const REFRESH_MS = 30_000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Reservas del modo demostración (solo este navegador; si el almacenamiento falla, en memoria).
let demoMemory: string[] = [];
const readDemo = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DEMO_KEY) ?? '[]');
  } catch {
    return demoMemory;
  }
};
const writeDemo = (list: string[]) => {
  demoMemory = list;
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(list));
  } catch {}
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const els = {
  days: $('days'),
  month: $('days-month'),
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
  doneWhen: $('done-when'),
  doneEmail: $('done-email'),
  doneMeet: $<HTMLAnchorElement>('done-meet'),
};

let slots: Slot[] = [];
let booked = new Set<number>();
let selectedDate: string | null = null;
let selectedSlot: Slot | null = null;

const fmt = (opts: Intl.DateTimeFormatOptions, tz = TIMEZONE) =>
  new Intl.DateTimeFormat('es-MX', { timeZone: tz, ...opts });
const longDate = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const monthYear = fmt({ month: 'long', year: 'numeric' });
const shortTime = fmt({ hour: '2-digit', minute: '2-digit', hour12: false });

const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const localTime = fmt({ hour: '2-digit', minute: '2-digit', hour12: false }, userTz);
const differentTz = (iso: string) => localTime.format(new Date(iso)) !== shortTime.format(new Date(iso));

const dateAtNoon = (ymd: string) => new Date(`${ymd}T12:00:00-06:00`);
const isBooked = (s: Slot) => booked.has(Date.parse(s.start));

// ---------- Datos ----------

async function fetchBooked(): Promise<Set<number>> {
  if (DEMO) {
    const list = readDemo();
    return new Set(list.map((s) => Date.parse(s)));
  }
  const from = slots[0]?.start ?? new Date().toISOString();
  const to = slots.at(-1)?.end ?? new Date().toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/booked_slots`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_ts: from, to_ts: to }),
  });
  if (!res.ok) throw new Error(`booked_slots ${res.status}`);
  const rows: string[] = await res.json();
  return new Set(rows.map((s) => Date.parse(s)));
}

type BookResult = { ok: true; meetUrl: string } | { ok: false; error: string };

async function book(payload: Record<string, string>): Promise<BookResult> {
  if (DEMO) {
    await new Promise((r) => setTimeout(r, 700));
    const list = readDemo();
    if (list.some((s) => Date.parse(s) === Date.parse(payload.slot))) return { ok: false, error: 'slot_taken' };
    writeDemo([...list, payload.slot]);
    return { ok: true, meetUrl: 'https://meet.google.com/abc-defg-hij' };
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/book`, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY!, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) return { ok: true, meetUrl: data.meetUrl };
    return { ok: false, error: data.error ?? 'server_error' };
  } catch {
    return { ok: false, error: 'network' };
  }
}

const ERRORS: Record<string, string> = {
  slot_taken: 'Alguien acaba de reservar ese horario. Por favor elija otro.',
  invalid_slot: 'Ese horario ya no está disponible. Por favor elija otro.',
  already_booked: 'Ya tiene una entrevista agendada con este correo. Revise su bandeja de entrada.',
  invalid_email: 'Revise su correo electrónico.',
  invalid_name: 'Escriba su nombre completo.',
  calendar_error: 'No pudimos crear la llamada en este momento. Intente de nuevo en unos minutos.',
  network: 'Sin conexión. Revise su internet e intente de nuevo.',
};

// ---------- Render ----------

function renderDays() {
  const byDate = new Map<string, Slot[]>();
  for (const s of slots) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);

  // Desde el lunes de esta semana (CDMX) hasta el viernes de la semana del último horario.
  const today = cdmxDate(new Date());
  const monday = dateAtNoon(today.date);
  monday.setUTCDate(monday.getUTCDate() - ((today.weekday + 6) % 7));
  const lastDate = slots.at(-1)?.date ?? today.date;
  const weeks = Math.ceil((dateAtNoon(lastDate).getTime() - monday.getTime()) / (7 * DAY_MS) + 1 / 7);

  const cells: string[] = [];
  const months = new Set<string>();
  for (let i = 0; i < weeks * 7; i++) {
    const { date, weekday } = cdmxDate(new Date(monday.getTime() + i * DAY_MS));
    if (weekday === 0 || weekday === 6) continue;
    const daySlots = byDate.get(date) ?? [];
    const free = daySlots.filter((s) => !isBooked(s)).length;
    const dayNum = Number(date.slice(8));
    const label = longDate.format(dateAtNoon(date));
    if (daySlots.length) months.add(monthYear.format(dateAtNoon(date)));

    if (daySlots.length === 0) {
      cells.push(`<div class="day day-empty" aria-hidden="true">${dayNum}</div>`);
    } else if (free === 0) {
      cells.push(
        `<button type="button" class="day day-full" disabled aria-label="${label}, sin horarios libres">${dayNum}<span class="sr-only">Lleno</span></button>`,
      );
    } else {
      const sel = date === selectedDate;
      cells.push(
        `<button type="button" data-date="${date}" class="day day-available${sel ? ' day-selected' : ''}" aria-pressed="${sel}" aria-label="${label}, ${free} ${free === 1 ? 'horario libre' : 'horarios libres'}">${dayNum}</button>`,
      );
    }
  }
  els.days.innerHTML = cells.join('');
  els.month.textContent = [...months].join(' – ').replace(/^./, (c) => c.toUpperCase());
}

function renderSlots() {
  if (!selectedDate) {
    els.dayLabel.textContent = 'Primero elija un día.';
    els.slots.innerHTML = '';
    els.tzNote.hidden = true;
    return;
  }
  const daySlots = slots.filter((s) => s.date === selectedDate);
  els.dayLabel.textContent = longDate.format(dateAtNoon(selectedDate)).replace(/^./, (c) => c.toUpperCase());
  let anyDifferentTz = false;
  els.slots.innerHTML = daySlots
    .map((s) => {
      const taken = isBooked(s);
      const range = `${shortTime.format(new Date(s.start))} – ${shortTime.format(new Date(s.end))}`;
      const local = differentTz(s.start);
      anyDifferentTz ||= local;
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
  els.tzNote.hidden = !anyDifferentTz;
  els.tzNote.textContent = anyDifferentTz ? `Horarios en hora de Ciudad de México. Su zona horaria: ${userTz}.` : '';
}

function render() {
  // Si el día elegido se llenó mientras tanto, se deselecciona.
  if (selectedDate && !slots.some((s) => s.date === selectedDate && !isBooked(s))) selectedDate = null;
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

function showError(code: string | null) {
  els.error.hidden = !code;
  els.error.textContent = code ? (ERRORS[code] ?? 'Algo salió mal. Intente de nuevo.') : '';
}

// ---------- Eventos ----------

async function refresh() {
  slots = upcomingSlots();
  try {
    booked = await fetchBooked();
  } catch (err) {
    console.error(err);
  }
  render();
}

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
  if (!selectedSlot) return;
  els.summaryDate.textContent = longDate.format(new Date(selectedSlot.start));
  els.summaryTime.textContent = `${shortTime.format(new Date(selectedSlot.start))} – ${shortTime.format(new Date(selectedSlot.end))} h (CDMX)`;
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

  const result = await book({ ...data, slot: selectedSlot.start });

  els.submit.disabled = false;
  els.submit.textContent = 'Confirmar entrevista';

  if (!result.ok) {
    showError(result.error);
    if (result.error === 'slot_taken' || result.error === 'invalid_slot') {
      await refresh();
      setTimeout(() => show('picker'), 1800);
    }
    return;
  }

  booked.add(Date.parse(selectedSlot.start));
  els.doneWhen.textContent = `${longDate.format(new Date(selectedSlot.start))} · ${shortTime.format(new Date(selectedSlot.start))} h (CDMX)`;
  els.doneEmail.textContent = data.email;
  els.doneMeet.href = result.meetUrl;
  els.form.reset();
  show('done');
  render();
});

// Mantiene los horarios al día: si alguien más reserva, el horario aparece como reservado.
setInterval(() => document.visibilityState === 'visible' && els.details.hidden && refresh(), REFRESH_MS);
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());

if (DEMO) $('demo-banner').hidden = false;
refresh();
