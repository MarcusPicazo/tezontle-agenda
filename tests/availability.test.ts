import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSlots, findDemoSlot, normalizeAvailability } from '../supabase/functions/_shared/availability.ts';

// Lunes 26 oct 2026, 08:00 en CDMX (14:00 UTC).
const now = new Date('2026-10-26T14:00:00Z');
const availability = { '2': [['09:00', '11:00']] as [string, string][], '6': [['10:00', '11:00']] as [string, string][] };

test('genera demos de 45 min cada 30 min dentro del rango', () => {
  const tue = demoSlots(availability, [], now).filter((s) => s.date === '2026-10-27');
  assert.deepEqual(tue.map((s) => s.time), ['09:00', '09:30', '10:00']);
  assert.equal(tue[0].start, '2026-10-27T15:00:00.000Z');
  assert.equal(tue[0].end, '2026-10-27T15:45:00.000Z');
});

test('respeta sábado (6) y no inventa domingos', () => {
  const sat = demoSlots(availability, [], now).filter((s) => s.date === '2026-10-31');
  assert.deepEqual(sat.map((s) => s.time), ['10:00']);
  assert.equal(demoSlots(availability, [], now).filter((s) => s.date === '2026-11-01').length, 0);
});

test('quita los espacios que se enciman con una cita', () => {
  const busy = [{ slot_start: '2026-10-27T15:30:00Z', slot_end: '2026-10-27T16:15:00Z' }]; // 09:30–10:15
  const tue = demoSlots(availability, busy, now).filter((s) => s.date === '2026-10-27');
  assert.deepEqual(tue.map((s) => s.time), []);
  assert.equal(findDemoSlot(availability, busy, '2026-10-27T15:00:00.000Z', now), null);
});

test('normaliza rangos: ordena, une encimados y descarta inválidos', () => {
  const n = normalizeAvailability({ '1': [['12:00', '14:00'], ['09:00', '12:30'], ['15:00', '15:30'], ['x', '1']], '9': [['09:00', '10:00']] });
  assert.deepEqual(n, { '1': [['09:00', '14:00']] });
});
