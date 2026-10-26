// Horarios de entrevista: ÚNICA fuente de verdad. La usan la página (src/) para pintar los
// espacios y la Edge Function `book` para validar que nadie reserve fuera de ellos.
// Sin dependencias de Deno ni de Node: TypeScript plano.

export const TIMEZONE = 'America/Mexico_City';
// México no tiene horario de verano desde 2022: CDMX es UTC-6 todo el año.
export const UTC_OFFSET = '-06:00';
const OFFSET_MS = -6 * 60 * 60 * 1000;

export const SLOT_MINUTES = 30;
// Cuántos días hacia adelante se pueden reservar.
export const DAYS_AHEAD = 21;
// Anticipación mínima para reservar (horas).
export const MIN_NOTICE_HOURS = 2;

// Inicio de cada espacio de 30 min, por día (1 = lunes … 5 = viernes), hora de CDMX.
// Derivados de los bloques disponibles:
//   Lunes 09:10–10:00 · Martes 11:30–12:20 · Miércoles 10:40–11:30, 11:30–12:20 y
//   11:00–14:00 sin 12:30–13:00 · Jueves 10:40–11:30 · Viernes 10:40–11:30 ·
//   Lunes a viernes 16:30–17:30.
export const WEEKLY_SLOTS: Record<number, string[]> = {
  1: ['09:10', '16:30', '17:00'],
  2: ['11:30', '16:30', '17:00'],
  3: ['10:40', '11:10', '11:40', '13:00', '13:30', '16:30', '17:00'],
  4: ['10:40', '16:30', '17:00'],
  5: ['10:40', '16:30', '17:00'],
};

export interface Slot {
  /** Inicio en ISO UTC, ej. "2026-10-28T16:40:00.000Z" — es la llave en la base de datos. */
  start: string;
  end: string;
  /** "2026-10-28" en hora de CDMX. */
  date: string;
  /** "10:40" en hora de CDMX. */
  time: string;
  weekday: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Fecha "AAAA-MM-DD" y día de la semana (0 = domingo) de un instante, en hora de CDMX. */
export function cdmxDate(instant: Date): { date: string; weekday: number } {
  const local = new Date(instant.getTime() + OFFSET_MS);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    weekday: local.getUTCDay(),
  };
}

/** Todos los espacios futuros reservables (respetando la anticipación mínima). */
export function upcomingSlots(now: Date = new Date()): Slot[] {
  const earliest = now.getTime() + MIN_NOTICE_HOURS * 60 * 60 * 1000;
  const slots: Slot[] = [];
  for (let i = 0; i <= DAYS_AHEAD; i++) {
    const day = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const { date, weekday } = cdmxDate(day);
    for (const time of WEEKLY_SLOTS[weekday] ?? []) {
      const start = new Date(`${date}T${time}:00${UTC_OFFSET}`);
      if (start.getTime() < earliest) continue;
      const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);
      slots.push({ start: start.toISOString(), end: end.toISOString(), date, time, weekday });
    }
  }
  return slots;
}

/** El espacio que empieza en `startIso`, o null si no es un horario válido y vigente. */
export function findSlot(startIso: string, now: Date = new Date()): Slot | null {
  const t = Date.parse(startIso);
  if (Number.isNaN(t)) return null;
  return upcomingSlots(now).find((s) => Date.parse(s.start) === t) ?? null;
}
