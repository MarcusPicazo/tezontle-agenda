// Edge Function `team`: acciones del panel del equipo que necesitan permisos de servidor.
// Requiere sesión (Authorization: Bearer <token del usuario>).
//
//   create_seller   (admin)              Alta de vendedor + su usuario con contraseña.
//   set_password    (admin)              Nueva contraseña para un vendedor.
//   cancel_booking  (vendedor o admin)   Cancela una demo: borra el evento (Google avisa a
//                                        los invitados) y libera el horario.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { cancelEvent } from '../_shared/google.ts';
import { cors, json } from '../_shared/http.ts';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

async function findAuthUser(email: string) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((u) => u.email?.toLowerCase() === email);
    if (user || data.users.length < 200) return user ?? null;
  }
  return null;
}

Deno.serve(async (req) => {
  const headers = cors(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (req.method !== 'POST') return json(headers, 405, { error: 'method_not_allowed' });

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const { data: auth } = await supabase.auth.getUser(jwt);
  const me = auth.user?.email?.toLowerCase();
  if (!me) return json(headers, 401, { error: 'unauthorized' });

  const { data: adminRow } = await supabase.from('admins').select('email').eq('email', me).maybeSingle();
  const isAdmin = !!adminRow;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(headers, 400, { error: 'invalid_json' });
  }

  try {
    switch (body.action) {
      case 'create_seller': {
        if (!isAdmin) return json(headers, 403, { error: 'forbidden' });
        const name = clean(body.name, 80);
        const email = clean(body.email, 200).toLowerCase();
        const slug = clean(body.slug, 40).toLowerCase();
        const title = clean(body.title, 80) || 'Asesor comercial';
        const password = clean(body.password, 72);
        if (name.length < 2) return json(headers, 400, { error: 'invalid_name' });
        if (!EMAIL_RE.test(email)) return json(headers, 400, { error: 'invalid_email' });
        if (!SLUG_RE.test(slug)) return json(headers, 400, { error: 'invalid_slug' });
        if (password.length < 8) return json(headers, 400, { error: 'weak_password' });

        const { data: taken } = await supabase.from('sellers').select('slug, email').or(`slug.eq.${slug},email.eq.${email}`);
        if (taken?.some((s) => s.slug === slug)) return json(headers, 409, { error: 'slug_taken' });
        if (taken?.some((s) => s.email === email)) return json(headers, 409, { error: 'email_taken' });

        // Si ya tiene usuario (por ejemplo, el propio administrador), conserva su contraseña.
        const existing = await findAuthUser(email);
        if (!existing) {
          const { error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
          if (error) throw error;
        }
        const { data: seller, error } = await supabase
          .from('sellers')
          .insert({ name, email, slug, title })
          .select('*')
          .single();
        if (error) throw error;
        return json(headers, 200, { ok: true, seller, existingUser: !!existing });
      }

      case 'set_password': {
        if (!isAdmin) return json(headers, 403, { error: 'forbidden' });
        const password = clean(body.password, 72);
        if (password.length < 8) return json(headers, 400, { error: 'weak_password' });
        const { data: seller } = await supabase.from('sellers').select('email').eq('id', clean(body.seller_id, 40)).maybeSingle();
        if (!seller) return json(headers, 404, { error: 'not_found' });
        const user = await findAuthUser(seller.email);
        if (!user) return json(headers, 404, { error: 'not_found' });
        const { error } = await supabase.auth.admin.updateUserById(user.id, { password });
        if (error) throw error;
        return json(headers, 200, { ok: true });
      }

      case 'cancel_booking': {
        const { data: booking } = await supabase
          .from('demo_bookings')
          .select('id, status, calendar_event_id, sellers!inner(email)')
          .eq('id', clean(body.booking_id, 40))
          .maybeSingle();
        if (!booking) return json(headers, 404, { error: 'not_found' });
        const ownerEmail = (booking.sellers as unknown as { email: string }).email;
        if (!isAdmin && ownerEmail !== me) return json(headers, 403, { error: 'forbidden' });
        if (booking.status === 'cancelled') return json(headers, 200, { ok: true });
        if (booking.calendar_event_id) await cancelEvent(booking.calendar_event_id);
        const { error } = await supabase.from('demo_bookings').update({ status: 'cancelled' }).eq('id', booking.id);
        if (error) throw error;
        return json(headers, 200, { ok: true });
      }

      default:
        return json(headers, 400, { error: 'unknown_action' });
    }
  } catch (err) {
    console.error(err);
    return json(headers, 500, { error: 'server_error' });
  }
});
