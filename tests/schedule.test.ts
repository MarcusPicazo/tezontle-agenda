import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSlot, upcomingSlots } from '../supabase/functions/_shared/schedule.ts';

// Lunes 26 oct 2026, 08:00 en CDMX (14:00 UTC).
const now = new Date('2026-10-26T14:00:00Z');

test('genera los horarios de la semana en hora de CDMX', () => {
  const week = upcomingSlots(now).filter((s) => s.date <= '2026-10-30');
  const byDay = (d: string) => week.filter((s) => s.date === d).map((s) => s.time);
  assert.deepEqual(byDay('2026-10-26'), ['16:30', '17:00']); // 09:10 queda dentro de las 2 h de anticipación
  assert.deepEqual(byDay('2026-10-27'), ['11:30', '16:30', '17:00']);
  assert.deepEqual(byDay('2026-10-28'), ['10:40', '11:10', '11:40', '13:00', '13:30', '16:30', '17:00']);
  assert.deepEqual(byDay('2026-10-29'), ['10:40', '16:30', '17:00']);
  assert.deepEqual(byDay('2026-10-30'), ['10:40', '16:30', '17:00']);
  assert.equal(week.filter((s) => s.weekday === 0 || s.weekday === 6).length, 0);
});

test('miércoles respeta el hueco de 12:30 a 13:00', () => {
  const wed = upcomingSlots(now).filter((s) => s.date === '2026-10-28');
  for (const s of wed) {
    const startMin = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3));
    assert.ok(startMin + 30 <= 12 * 60 + 30 || startMin >= 13 * 60, s.time);
  }
});

test('convierte a UTC correctamente (UTC-6)', () => {
  const s = upcomingSlots(now).find((x) => x.date === '2026-10-28' && x.time === '10:40')!;
  assert.equal(s.start, '2026-10-28T16:40:00.000Z');
  assert.equal(s.end, '2026-10-28T17:10:00.000Z');
});

test('findSlot rechaza horarios inventados o pasados', () => {
  assert.ok(findSlot('2026-10-28T16:40:00.000Z', now));
  assert.ok(findSlot('2026-10-28T16:40:00+00:00', now));
  assert.equal(findSlot('2026-10-28T16:45:00.000Z', now), null);
  assert.equal(findSlot('2026-10-26T15:10:00.000Z', now), null); // lunes 09:10, muy pronto
  assert.equal(findSlot('basura', now), null);
});
