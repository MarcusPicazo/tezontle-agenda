// Edge Function `book-demo`: un cliente reserva una demo con un vendedor.
//
// 1. Valida datos, que el vendedor exista y esté activo, y que el horario salga de sus
//    horarios (availability.ts) y siga libre.
// 2. Inserta la cita. La restricción de la base impide dos citas encimadas del mismo
//    vendedor aunque lleguen al mismo tiempo (409).
// 3. Crea el evento con Meet en el calendario de Tezontle e invita al cliente y al vendedor.
// Si Google falla, borra la cita para no dejar el horario bloqueado.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { DEMO_MINUTES, findDemoSlot, normalizeAvailability } from '../_shared/availability.ts';
import { createMeetEvent } from '../_shared/google.ts';
import { TIMEZONE } from '../_shared/schedule.ts';
import { cors, json } from '../_shared/http.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UNITS = ['Menos de 50', '50 a 150', 'Más de 150'];
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const formatCdmx = (iso: string) =>
  new Intl.DateTimeFormat('es-MX', {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(headers, 405, { error: 'method_not_allowed' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(headers, 400, { error: 'invalid_json' });
  }
  if (clean(body.website, 200)) return json(headers, 200, { ok: true });

  const data = {
    name: clean(body.name, 120),
    email: clean(body.email, 200).toLowerCase(),
    phone: clean(body.phone, 40),
    company: clean(body.company, 120),
    city: clean(body.city, 80),
    units: clean(body.units, 40),
  };
  if (data.name.length < 2) return json(headers, 400, { error: 'invalid_name' });
  if (!EMAIL_RE.test(data.email)) return json(headers, 400, { error: 'invalid_email' });
  if (data.phone.replace(/\D/g, '').length < 7) return json(headers, 400, { error: 'invalid_phone' });
  if (data.company.length < 2 || data.city.length < 2) return json(headers, 400, { error: 'invalid_company' });
  if (!UNITS.includes(data.units)) return json(headers, 400, { error: 'invalid_units' });

  const { data: seller } = await supabase
    .from('sellers')
    .select('id, name, email, availability')
    .eq('slug', clean(body.seller, 40).toLowerCase())
    .eq('active', true)
    .maybeSingle();
  if (!seller) return json(headers, 404, { error: 'seller_not_found' });

  const now = new Date();
  const { data: busy, error: busyErr } = await supabase
    .from('demo_bookings')
    .select('slot_start, slot_end')
    .eq('seller_id', seller.id)
    .eq('status', 'confirmed')
    .gte('slot_end', now.toISOString());
  if (busyErr) {
    console.error(busyErr);
    return json(headers, 500, { error: 'server_error' });
  }

  const slot = findDemoSlot(normalizeAvailability(seller.availability), busy ?? [], clean(body.slot, 40), now);
  if (!slot) return json(headers, 409, { error: 'slot_taken' });

  const { data: booking, error: insertErr } = await supabase
    .from('demo_bookings')
    .insert({ seller_id: seller.id, slot_start: slot.start, slot_end: slot.end, ...data })
    .select('id')
    .single();
  if (insertErr) {
    // 23P01: choca con otra cita del vendedor (restricción de exclusión).
    if (insertErr.code === '23P01') return json(headers, 409, { error: 'slot_taken' });
    console.error(insertErr);
    return json(headers, 500, { error: 'server_error' });
  }

  let event: { id: string; meetUrl: string };
  try {
    event = await createMeetEvent({
      requestId: booking.id,
      summary: `Demo Tezontle 3D — ${data.company} · ${seller.name}`,
      description: [
        `Demo de Tezontle 3D (${DEMO_MINUTES} min) con ${seller.name}.`,
        '',
        `Cliente: ${data.name}`,
        `Desarrolladora: ${data.company}`,
        `Ciudad del proyecto: ${data.city}`,
        `Número de departamentos: ${data.units}`,
        `Correo: ${data.email}`,
        `WhatsApp: ${data.phone}`,
        '',
        `Horario: ${formatCdmx(slot.start)} (hora de CDMX)`,
      ].join('\n'),
      start: slot.start,
      end: slot.end,
      attendees: [
        { email: data.email, displayName: data.name },
        { email: seller.email, displayName: `${seller.name} · Tezontle 3D` },
      ],
    });
  } catch (err) {
    console.error(err);
    await supabase.from('demo_bookings').delete().eq('id', booking.id);
    return json(headers, 502, { error: 'calendar_error' });
  }

  await supabase.from('demo_bookings').update({ meet_url: event.meetUrl, calendar_event_id: event.id }).eq('id', booking.id);
  return json(headers, 200, { ok: true, slot: slot.start, meetUrl: event.meetUrl });
});
