// Google Calendar + Meet con la cuenta de Google de Tezontle (GOOGLE_REFRESH_TOKEN).
// Lo usan las Edge Functions `book`, `book-demo` y `team`.

import { TIMEZONE } from './schedule.ts';

const env = (k: string) => Deno.env.get(k) ?? '';

async function accessToken(): Promise<string> {
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

const calendarUrl = () =>
  `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env('GOOGLE_CALENDAR_ID') || 'primary')}/events`;

/** Crea el evento con enlace de Meet e invita a los asistentes (Google les manda el correo). */
export async function createMeetEvent(p: {
  requestId: string;
  summary: string;
  description: string;
  start: string;
  end: string;
  attendees: { email: string; displayName?: string }[];
}): Promise<{ id: string; meetUrl: string }> {
  const res = await fetch(`${calendarUrl()}?conferenceDataVersion=1&sendUpdates=all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: p.summary,
      description: p.description,
      start: { dateTime: p.start, timeZone: TIMEZONE },
      end: { dateTime: p.end, timeZone: TIMEZONE },
      attendees: p.attendees,
      guestsCanModify: false,
      guestsCanInviteOthers: false,
      conferenceData: {
        createRequest: { requestId: p.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 15 },
        ],
      },
    }),
  });
  const event = await res.json();
  if (!res.ok) throw new Error(`google_event: ${JSON.stringify(event)}`);
  const meetUrl =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find((e: { entryPointType: string }) => e.entryPointType === 'video')?.uri;
  if (!meetUrl) throw new Error('google_event: sin enlace de Meet');
  return { id: event.id, meetUrl };
}

/** Borra el evento y Google avisa de la cancelación a los invitados. */
export async function cancelEvent(eventId: string): Promise<void> {
  const res = await fetch(`${calendarUrl()}/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  // 410: ya estaba borrado en el calendario.
  if (!res.ok && res.status !== 410) throw new Error(`google_cancel: ${res.status} ${await res.text()}`);
}
