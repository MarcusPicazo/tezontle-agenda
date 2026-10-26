// Tarea programada de Netlify: consulta Supabase una vez al día para que el proyecto gratuito
// no se pause por 7 días sin actividad. Usa las mismas variables de entorno que la página.

export default async () => {
  const url = process.env.PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('keep-alive: faltan PUBLIC_SUPABASE_URL o PUBLIC_SUPABASE_ANON_KEY');
    return;
  }
  const now = new Date();
  const res = await fetch(`${url}/rest/v1/rpc/booked_slots`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_ts: now.toISOString(), to_ts: new Date(now.getTime() + 864e5).toISOString() }),
  });
  console.log(`keep-alive: Supabase respondió ${res.status}`);
};

export const config = {
  schedule: '@daily',
};
