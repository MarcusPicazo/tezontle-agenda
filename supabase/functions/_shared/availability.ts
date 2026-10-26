// Horarios de demos por vendedor: convierte los rangos que cada vendedor marca en su panel en
// espacios reservables. Lo usan la página pública (src/) y la Edge Function `book-demo`.
// Sin dependencias de Deno ni de Node: TypeScript plano.

import { cdmxDate, UTC_OFFSET } from './schedule.ts';

export const DEMO_MINUTES = 45;
// Cada cuánto puede empezar una demo dentro de un rango.
export const DEMO_STEP_MINUTES = 30;
export const DEMO_DAYS_AHEAD = 30;
export const DEMO_MIN_NOTICE_HOURS = 4;

/** "1" = lunes … "7" = domingo → lista de rangos ["09:00", "13:00"] en hora de CDMX. */
export type Availability = Record<string, [string, string][]>;

export interface DemoSlot {
  start: string;
  end: string;
  /** "2026-10-28" en hora de CDMX. */
  date: string;
  /** "10:30" en hora de CDMX. */
  time: string;
}

export interface Busy {
  slot_start: string;
  slot_end: string;
}

const MIN_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MIN_MS;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Día de la semana ISO (1 = lunes … 7 = domingo). */
export const isoWeekday = (jsDay: number) => (jsDay === 0 ? 7 : jsDay);

/** Limpia lo que llega del panel: rangos válidos, ordenados y sin encimarse. */
export function normalizeAvailability(input: unknown): Availability {
  const out: Availability = {};
  if (!input || typeof input !== 'object') return out;
  for (let d = 1; d <= 7; d++) {
    const ranges = (input as Record<string, unknown>)[String(d)];
    if (!Array.isArray(ranges)) continue;
    const valid = ranges
      .filter(
        (r): r is [string, string] =>
          Array.isArray(r) && TIME_RE.test(r[0]) && TIME_RE.test(r[1]) && toMinutes(r[1]) - toMinutes(r[0]) >= DEMO_MINUTES,
      )
      .sort((a, b) => toMinutes(a[0]) - toMinutes(b[0]));
    const merged: [string, string][] = [];
    for (const r of valid) {
      const last = merged.at(-1);
      if (last && toMinutes(r[0]) <= toMinutes(last[1])) {
        if (toMinutes(r[1]) > toMinutes(last[1])) last[1] = r[1];
      } else merged.push([r[0], r[1]]);
    }
    if (merged.length) out[String(d)] = merged;
  }
  return out;
}

/** Espacios futuros del vendedor, quitando los que se enciman con citas ya confirmadas. */
export function demoSlots(availability: Availability, busy: Busy[] = [], now: Date = new Date()): DemoSlot[] {
  const clean = normalizeAvailability(availability);
  const earliest = now.getTime() + DEMO_MIN_NOTICE_HOURS * 60 * MIN_MS;
  const busyMs = busy.map((b) => [Date.parse(b.slot_start), Date.parse(b.slot_end)] as const);
  const slots: DemoSlot[] = [];
  for (let i = 0; i <= DEMO_DAYS_AHEAD; i++) {
    const { date, weekday } = cdmxDate(new Date(now.getTime() + i * DAY_MS));
    for (const [from, to] of clean[String(isoWeekday(weekday))] ?? []) {
      for (let m = toMinutes(from); m + DEMO_MINUTES <= toMinutes(to); m += DEMO_STEP_MINUTES) {
        const time = toTime(m);
        const start = Date.parse(`${date}T${time}:00${UTC_OFFSET}`);
        const end = start + DEMO_MINUTES * MIN_MS;
        if (start < earliest) continue;
        if (busyMs.some(([bs, be]) => start < be && end > bs)) continue;
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), date, time });
      }
    }
  }
  return slots;
}

/** El espacio que empieza en `startIso` si es válido y está libre; si no, null. */
export function findDemoSlot(
  availability: Availability,
  busy: Busy[],
  startIso: string,
  now: Date = new Date(),
): DemoSlot | null {
  const t = Date.parse(startIso);
  if (Number.isNaN(t)) return null;
  return demoSlots(availability, busy, now).find((s) => Date.parse(s.start) === t) ?? null;
}
