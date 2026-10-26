// CORS y respuestas JSON para las Edge Functions de demos y del equipo.

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin');
  const allowed = ALLOWED_ORIGINS.length === 0 || (origin && ALLOWED_ORIGINS.includes(origin));
  return {
    'Access-Control-Allow-Origin': allowed && origin ? origin : ALLOWED_ORIGINS[0] ?? '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

export const json = (headers: Record<string, string>, status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
