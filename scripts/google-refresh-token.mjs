// Obtiene el GOOGLE_REFRESH_TOKEN de la cuenta de Google donde se crearán las llamadas.
// Uso:  GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google-token
// Requiere un cliente OAuth de tipo "App de escritorio" (ver README, paso 3).
import http from 'node:http';

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error('Faltan GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.');
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://localhost:${PORT}`;
const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
  });

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, redirectUri).searchParams.get('code');
  if (!code) return res.end('Sin código.');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = await tokenRes.json();
  res.end(data.refresh_token ? 'Listo. Ya puede cerrar esta pestaña.' : 'Error, revise la terminal.');
  console.log(data.refresh_token ? `\nGOOGLE_REFRESH_TOKEN=${data.refresh_token}\n` : data);
  server.close();
});

server.listen(PORT, () => {
  console.log('Abra este enlace e inicie sesión con la cuenta de Google donde se crearán las llamadas:\n');
  console.log(authUrl + '\n');
});
