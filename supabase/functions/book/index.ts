// Edge Function `book`: reserva un horario de entrevista.
//
// 1. Valida datos y que el horario exista en schedule.ts y siga vigente.
// 2. Inserta la reserva. El índice único de la base desactiva el horario: si alguien más lo
//    tomó un instante antes, responde 409 y la página se refresca.
// 3. Crea el evento en Google Calendar con enlace de Google Meet e invita al candidato y a
//    Marcus (sendUpdates=all: Google les manda el correo con el enlace a ambos).
// 4. Opcional: si hay RESEND_API_KEY, manda además un correo con la marca de Tezontle.
// Si Google falla, borra la reserva para no dejar el horario bloqueado sin llamada.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { findSlot, SLOT_MINUTES, TIMEZONE } from '../_shared/schedule.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

const MARCUS_EMAIL = env('MARCUS_EMAIL');
const ALLOWED_ORIGINS = env('ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);

const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

function cors(origin: string | null): Record<string, string> {
  const allow = ALLOWED_ORIGINS.length === 0 || (origin && ALLOWED_ORIGINS.includes(origin));
  return {
    'Access-Control-Allow-Origin': allow && origin ? origin : ALLOWED_ORIGINS[0] ?? '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function formatCdmx(iso: string) {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: TIMEZONE,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

async function googleAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) throw new Error(`google_token: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function createMeetEvent(p: {
  bookingId: string;
  start: string;
  end: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
}): Promise<{ id: string; meetUrl: string }> {
  const token = await googleAccessToken();
  const calendarId = encodeURIComponent(env('GOOGLE_CALENDAR_ID') || 'primary');
  const attendees = [{ email: p.email, displayName: p.name }];
  if (MARCUS_EMAIL) attendees.push({ email: MARCUS_EMAIL, displayName: 'Marcus · Tezontle 3D' });

  const description = [
    'Entrevista del proceso de selección para el equipo de ventas de Tezontle 3D.',
    '',
    `Candidato: ${p.name}`,
    `Correo: ${p.email}`,
    p.phone ? `Teléfono: ${p.phone}` : '',
    p.notes ? `Comentarios: ${p.notes}` : '',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: `Entrevista ventas · Tezontle 3D — ${p.name}`,
        description,
        start: { dateTime: p.start, timeZone: TIMEZONE },
        end: { dateTime: p.end, timeZone: TIMEZONE },
        attendees,
        guestsCanModify: false,
        guestsCanInviteOthers: false,
        conferenceData: {
          createRequest: { requestId: p.bookingId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 15 },
          ],
        },
      }),
    },
  );
  const event = await res.json();
  if (!res.ok) throw new Error(`google_event: ${JSON.stringify(event)}`);
  const meetUrl =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e: { entryPointType: string }) => e.entryPointType === 'video')?.uri;
  if (!meetUrl) throw new Error('google_event: sin enlace de Meet');
  return { id: event.id, meetUrl };
}

function brandedEmail(p: { title: string; intro: string; when: string; meetUrl: string; extra?: string }) {
  return `<!doctype html><html><body style="margin:0;background:#F4EFE8;font-family:Manrope,Arial,sans-serif;color:#2B2B2B">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px"><tr><td align="center">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FBF9F5;border-radius:20px;padding:32px">
    <tr><td style="padding-bottom:24px">
      <span style="display:inline-block;width:28px;height:5px;background:#2B2B2B;border-radius:2px"></span><br>
      <span style="display:inline-block;width:22px;height:5px;background:#9A4535;border-radius:2px;margin:3px 0 3px 6px"></span><br>
      <span style="display:inline-block;width:28px;height:5px;background:#2B2B2B;border-radius:2px"></span>
      <span style="font-family:Georgia,serif;font-size:22px;vertical-align:6px;margin-left:8px">tezontle</span>
    </td></tr>
    <tr><td style="font-family:Georgia,serif;font-size:26px;line-height:1.25;padding-bottom:12px">${p.title}</td></tr>
    <tr><td style="font-size:15px;line-height:1.6;color:#5A544C;padding-bottom:20px">${p.intro}</td></tr>
    <tr><td style="background:#F4EFE8;border-radius:14px;padding:16px 18px;font-size:15px;line-height:1.6">
      <strong>${p.when}</strong> (hora de CDMX)<br>Duración: ${SLOT_MINUTES} minutos · Google Meet${p.extra ?? ''}
    </td></tr>
    <tr><td style="padding-top:24px">
      <a href="${p.meetUrl}" style="display:inline-block;background:#C8A27A;color:#2B2B2B;font-weight:600;text-decoration:none;border-radius:999px;padding:12px 22px">Entrar a la llamada</a>
      <div style="font-size:13px;color:#5A544C;padding-top:10px">${p.meetUrl}</div>
    </td></tr>
  </table></td></tr></table></body></html>`;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

async function sendBrandedEmails(p: { name: string; email: string; phone: string; notes: string; start: string; meetUrl: string }) {
  const key = env('RESEND_API_KEY');
  if (!key) return;
  const from = env('EMAIL_FROM') || 'Tezontle 3D <onboarding@resend.dev>';
  const when = formatCdmx(p.start);
  const send = (to: string, subject: string, html: string) =>
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, reply_to: MARCUS_EMAIL || undefined }),
    });
  const name = escapeHtml(p.name);
  const jobs = [
    send(
      p.email,
      'Su entrevista con Tezontle 3D está confirmada',
      brandedEmail({
        title: `¡Listo, ${name}! Su entrevista está confirmada.`,
        intro: 'Gracias por su interés en el equipo de ventas de Tezontle 3D. Le esperamos en la llamada:',
        when,
        meetUrl: p.meetUrl,
      }),
    ),
  ];
  if (MARCUS_EMAIL) {
    jobs.push(
      send(
        MARCUS_EMAIL,
        `Nueva entrevista: ${p.name} — ${when}`,
        brandedEmail({
          title: 'Nueva entrevista agendada',
          intro: `${name} reservó una entrevista para ventas.`,
          when,
          meetUrl: p.meetUrl,
          extra: `<br>Correo: ${escapeHtml(p.email)}${p.phone ? `<br>Teléfono: ${escapeHtml(p.phone)}` : ''}${
            p.notes ? `<br>Comentarios: ${escapeHtml(p.notes)}` : ''
          }`,
        }),
      ),
    );
  }
  const results = await Promise.allSettled(jobs);
  results.forEach((r) => r.status === 'rejected' && console.error('resend', r.reason));
}

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('Origin')), 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'invalid_json' });
  }

  // Campo trampa: los bots lo llenan, las personas no lo ven.
  if (clean(body.website, 200)) return reply(200, { ok: true });

  const name = clean(body.name, 120);
  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 40);
  const notes = clean(body.notes, 1000);
  if (name.length < 2) return reply(400, { error: 'invalid_name' });
  if (!EMAIL_RE.test(email)) return reply(400, { error: 'invalid_email' });

  const slot = findSlot(clean(body.slot, 40));
  if (!slot) return reply(400, { error: 'invalid_slot' });

  // Una entrevista pendiente por persona.
  const { data: existing, error: existingErr } = await supabase
    .from('bookings')
    .select('slot_start')
    .eq('email', email)
    .eq('status', 'confirmed')
    .gte('slot_start', new Date().toISOString())
    .limit(1);
  if (existingErr) {
    console.error(existingErr);
    return reply(500, { error: 'server_error' });
  }
  if (existing && existing.length > 0) {
    return reply(409, { error: 'already_booked', slot: existing[0].slot_start });
  }

  const { data: booking, error: insertErr } = await supabase
    .from('bookings')
    .insert({ slot_start: slot.start, slot_end: slot.end, name, email, phone: phone || null, notes: notes || null })
    .select('id')
    .single();
  if (insertErr) {
    if (insertErr.code === '23505') return reply(409, { error: 'slot_taken' });
    console.error(insertErr);
    return reply(500, { error: 'server_error' });
  }

  let event: { id: string; meetUrl: string };
  try {
    event = await createMeetEvent({ bookingId: booking.id, start: slot.start, end: slot.end, name, email, phone, notes });
  } catch (err) {
    console.error(err);
    await supabase.from('bookings').delete().eq('id', booking.id);
    return reply(502, { error: 'calendar_error' });
  }

  await supabase.from('bookings').update({ meet_url: event.meetUrl, calendar_event_id: event.id }).eq('id', booking.id);
  await sendBrandedEmails({ name, email, phone, notes, start: slot.start, meetUrl: event.meetUrl });

  return reply(200, { ok: true, slot: slot.start, meetUrl: event.meetUrl });
});
