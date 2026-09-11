const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const ContentModel = require('./content-model');
const { createClient } = require('@supabase/supabase-js');

loadEnvFile();

const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, 'content.json');
const PORT = Number(process.env.PORT || 3000);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
const COOKIE_NAME = 'prensa_session';
const cookieOptions = `HttpOnly; SameSite=Lax; Path=/${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif' };

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Configurá SUPABASE_URL y SUPABASE_PUBLISHABLE_KEY en .env antes de iniciar.');
  process.exit(1);
}

function newAuthClient() {
  // Una instancia por sesión evita compartir credenciales entre visitantes.
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) },
  });
}
const isAdmin = (user) => user?.app_metadata?.role === 'admin';

function loadEnvFile() {
  try {
    const text = require('fs').readFileSync(path.join(__dirname, '.env'), 'utf8');
    text.split(/\r?\n/).forEach((line) => {
      const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    });
  } catch (error) {
    // En producción, las variables pueden venir del entorno del hosting.
  }
}

function contentSecurityPolicy(nonce = '') {
  const scriptSource = nonce ? `script-src 'self' 'nonce-${nonce}'` : "script-src 'self'";
  return `default-src 'self'; ${scriptSource}; img-src 'self' https: data: blob:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
}

function send(response, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  response.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': contentSecurityPolicy(), 'Cache-Control': 'no-store', ...headers });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function sendHtml(response, body) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const html = body.toString('utf8').replace(/<script\b/gi, `<script nonce="${nonce}"`);
  return send(response, 200, html, 'text/html; charset=utf-8', { 'Content-Security-Policy': contentSecurityPolicy(nonce), 'Cache-Control': 'no-cache' });
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function sessionFrom(request) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

async function authorizedSession(request) {
  const session = sessionFrom(request);
  if (!session) return null;
  // getUser consulta Auth y renueva la sesión vencida con el refresh token.
  const { data, error } = await session.client.auth.getUser();
  if (error || !isAdmin(data.user) || data.user.id !== session.userId) {
    sessions.delete(session.token);
    return null;
  }
  return session;
}

async function readBody(request, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  if (size > limit) throw Object.assign(new Error('El archivo o contenido supera el tamaño permitido.'), { status: 413 });
  return Buffer.concat(chunks);
}
async function readJson(request) {
  return JSON.parse((await readBody(request, 32 * 1024 * 1024)).toString('utf8'));
}
function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) return 'gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/api/content') {
    try { return send(response, 200, ContentModel.normalize(JSON.parse(await fs.readFile(CONTENT_FILE, 'utf8')))); } catch (error) { return send(response, 500, { error: 'No se pudo cargar el contenido.' }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/login') {
    const address = request.socket.remoteAddress || 'unknown';
    const current = attempts.get(address) || { count: 0, until: 0 };
    if (current.until > Date.now()) return send(response, 429, { error: 'Demasiados intentos. Probá más tarde.' });
    try {
      const body = await readJson(request);
      if (typeof body.email !== 'string' || typeof body.password !== 'string' || !body.email.trim() || !body.password || body.email.length > 320 || body.password.length > 1024) throw Object.assign(new Error('invalid'), { code: 'invalid_credentials' });
      const client = newAuthClient();
      const { data, error } = await client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
      if (error) throw error;
      if (!data.session) throw Object.assign(new Error('Missing session'), { code: 'missing_session' });
      if (!isAdmin(data.user)) {
        await client.auth.signOut({ scope: 'local' });
        throw Object.assign(new Error('Forbidden'), { code: 'editorial_forbidden' });
      }
      const previous = sessionFrom(request);
      if (previous) {
        sessions.delete(previous.token);
        await previous.client.auth.signOut({ scope: 'local' });
      }
      attempts.delete(address);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { client, userId: data.user.id, expires: Date.now() + SESSION_TTL_MS });
      return send(response, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': `${COOKIE_NAME}=${token}; ${cookieOptions}; Max-Age=${SESSION_TTL_MS / 1000}` });
    } catch (error) {
      const code = error.code || 'auth_unavailable';
      // Registrar únicamente códigos técnicos; nunca credenciales ni tokens.
      console.warn('[auth/login]', code, error.status || '');
      if (code === 'editorial_forbidden') return send(response, 403, { error: 'Tu cuenta no tiene permisos de administrador.' });
      if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit' || error.status === 429) {
        return send(response, 429, { error: 'Demasiados intentos. Esperá unos minutos antes de volver a ingresar.' });
      }
      if (code !== 'invalid_credentials' && code !== 'email_not_confirmed' && code !== 'user_banned') {
        return send(response, 502, { error: 'No se pudo conectar con el servicio de acceso. Probá nuevamente en unos momentos.' });
      }
      current.count += 1;
      if (current.count >= 5) { current.count = 0; current.until = Date.now() + 15 * 60 * 1000; }
      attempts.set(address, current);
      return send(response, 401, { error: 'Supabase rechazó el correo o la contraseña. Usá las credenciales actuales de la web de ACSERP.' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    const session = sessionFrom(request);
    if (session) {
      sessions.delete(session.token);
      await session.client.auth.signOut({ scope: 'local' });
    }
    return send(response, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': `${COOKIE_NAME}=; ${cookieOptions}; Max-Age=0` });
  }
  if (request.method === 'POST' && url.pathname === '/api/images') {
    if (!await authorizedSession(request)) return send(response, 401, { error: 'La sesión venció. Volvé a ingresar.' });
    try {
      const bytes = await readBody(request, 20 * 1024 * 1024);
      const extension = imageExtension(bytes);
      if (!extension) return send(response, 415, { error: 'Usá una imagen JPG, PNG, WebP o GIF.' });
      const filename = `${crypto.randomUUID()}.${extension}`;
      await fs.mkdir(path.join(ROOT, 'uploads'), { recursive: true });
      await fs.writeFile(path.join(ROOT, 'uploads', filename), bytes, { flag: 'wx' });
      return send(response, 201, { url: `/uploads/${filename}` });
    } catch (error) { return send(response, error.status || 500, { error: error.status === 413 ? 'La imagen supera el límite de 20 MB.' : 'No se pudo subir la imagen.' }); }
  }
  if (request.method === 'PUT' && url.pathname === '/api/content') {
    if (!await authorizedSession(request)) return send(response, 401, { error: 'Sesión no válida.' });
    try {
      const content = await readJson(request);
      if (!ContentModel.valid(content)) return send(response, 400, { error: 'Contenido inválido.' });
      const temporary = `${CONTENT_FILE}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(content, null, 2) + '\n', 'utf8');
      await fs.rename(temporary, CONTENT_FILE);
      return send(response, 200, { ok: true });
    } catch (error) { return send(response, error.status || 400, { error: error.status === 413 ? 'El contenido supera el límite de 32 MB.' : 'No se pudo guardar el contenido.' }); }
  }
  if (request.method !== 'GET') return send(response, 405, { error: 'Método no permitido.' });
  const requested = decodeURIComponent(url.pathname === '/' ? '/pagina-independiente_4.html' : url.pathname);
  const publicExtension = /\.(html|css|png|jpe?g|gif|webp|svg|ico|pdf|mp4)$/i;
  if (requested.split('/').some((part) => part.startsWith('.')) || (!publicExtension.test(requested) && !['/editor.js', '/content-model.js'].includes(requested)) || requested.includes('/node_modules/')) {
    return send(response, 404, 'No encontrado.', 'text/plain; charset=utf-8');
  }
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(ROOT + path.sep)) return send(response, 403, { error: 'Acceso denegado.' });
  try {
    const type = staticTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const file = await fs.readFile(filePath);
    return type.startsWith('text/html') ? sendHtml(response, file) : send(response, 200, file, type, { 'Cache-Control': 'no-cache' });
  } catch (error) { return send(response, 404, 'No encontrado.', 'text/plain; charset=utf-8'); }
}

http.createServer((request, response) => route(request, response).catch(() => send(response, 500, { error: 'Error interno.' }))).listen(PORT, () => console.log(`Servidor disponible en http://localhost:${PORT}`));
