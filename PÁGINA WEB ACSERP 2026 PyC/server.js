const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

loadEnvFile();

const ROOT = __dirname;
const CONTENT_FILE = path.join(ROOT, 'content.json');
const PORT = Number(process.env.PORT || 3000);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();
const attempts = new Map();
const staticTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.pdf': 'application/pdf', '.mp4': 'video/mp4' };

if (!ADMIN_EMAIL || !PASSWORD_HASH.startsWith('scrypt:') || !SESSION_SECRET || SESSION_SECRET.length < 32) {
  console.error('Configurá ADMIN_EMAIL, ADMIN_PASSWORD_HASH y SESSION_SECRET en .env antes de iniciar.');
  process.exit(1);
}

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

function send(response, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  response.writeHead(status, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data:; media-src 'self' https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'", 'Cache-Control': 'no-store', ...headers });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function sessionFrom(request) {
  const token = parseCookies(request).session;
  if (!token) return null;
  const session = sessions.get(token);
  if (!session || session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function passwordMatches(password) {
  const [, salt, expectedHex] = PASSWORD_HASH.split(':');
  if (!salt || !expectedHex || !password) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > 5 * 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

function validResourceUrl(value, allowImageData = false) {
  if (typeof value !== 'string' || value.length > 4_000_000 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (!value) return true;
  if (allowImageData && /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/]+=*$/i.test(value)) return true;
  if (/^(javascript|vbscript|data|file):/i.test(value) || value.startsWith('//')) return false;
  if (/^https?:\/\//i.test(value)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(value) && !value.startsWith('\\');
}

function validContent(content) {
  if (!content || !Array.isArray(content.diarios) || content.diarios.length !== 3 || !Array.isArray(content.noticieros) || !Array.isArray(content.entrevistas)) return false;
  return [...content.diarios.flat(), ...content.noticieros, ...content.entrevistas].every((item) => item && Array.isArray(item.imagenes) && item.imagenes.length <= 20 && item.imagenes.every((image) => validResourceUrl(image, true)) && validResourceUrl(item.link || '') && validResourceUrl(item.video || '') && typeof item.texto === 'string' && item.texto.length <= 2_000);
}

async function route(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/api/content') {
    try { return send(response, 200, JSON.parse(await fs.readFile(CONTENT_FILE, 'utf8'))); } catch (error) { return send(response, 500, { error: 'No se pudo cargar el contenido.' }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/login') {
    const address = request.socket.remoteAddress || 'unknown';
    const current = attempts.get(address) || { count: 0, until: 0 };
    if (current.until > Date.now()) return send(response, 429, { error: 'Demasiados intentos. Probá más tarde.' });
    try {
      const body = await readJson(request);
      if (String(body.email || '').trim().toLowerCase() !== ADMIN_EMAIL || !passwordMatches(String(body.password || ''))) throw new Error('invalid');
      attempts.delete(address);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { expires: Date.now() + SESSION_TTL_MS });
      return send(response, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': `session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}` });
    } catch (error) {
      current.count += 1;
      if (current.count >= 5) { current.count = 0; current.until = Date.now() + 15 * 60 * 1000; }
      attempts.set(address, current);
      return send(response, 401, { error: 'El correo o la contraseña no son válidos.' });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/logout') {
    const session = sessionFrom(request);
    if (session) sessions.delete(session.token);
    return send(response, 200, { ok: true }, 'application/json; charset=utf-8', { 'Set-Cookie': 'session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (request.method === 'PUT' && url.pathname === '/api/content') {
    if (!sessionFrom(request)) return send(response, 401, { error: 'Sesión no válida.' });
    try {
      const content = await readJson(request);
      if (!validContent(content)) return send(response, 400, { error: 'Contenido inválido.' });
      await fs.writeFile(CONTENT_FILE, JSON.stringify(content, null, 2) + '\n', 'utf8');
      return send(response, 200, { ok: true });
    } catch (error) { return send(response, 400, { error: 'No se pudo guardar el contenido.' }); }
  }
  if (request.method !== 'GET') return send(response, 405, { error: 'Método no permitido.' });
  const requested = decodeURIComponent(url.pathname === '/' ? '/pagina-independiente_4.html' : url.pathname);
  const filePath = path.resolve(ROOT, `.${requested}`);
  if (!filePath.startsWith(ROOT + path.sep)) return send(response, 403, { error: 'Acceso denegado.' });
  try { return send(response, 200, await fs.readFile(filePath), staticTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream', { 'Cache-Control': 'no-cache' }); } catch (error) { return send(response, 404, 'No encontrado.', 'text/plain; charset=utf-8'); }
}

http.createServer((request, response) => route(request, response).catch(() => send(response, 500, { error: 'Error interno.' }))).listen(PORT, () => console.log(`Servidor disponible en http://localhost:${PORT}`));
