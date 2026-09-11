const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

test('Acceso editorial con Supabase y archivos privados', async (t) => {
  let role = 'admin';
  let active = true;
  let revoked = 0;
  let refreshed = 0;
  const user = () => ({ id: '11111111-1111-4111-8111-111111111111', email: 'admin@example.test', app_metadata: { role }, user_metadata: { role: 'admin' } });
  const auth = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    let raw = ''; for await (const part of req) raw += part;
    const body = raw ? JSON.parse(raw) : {};
    if (req.url.startsWith('/auth/v1/token')) {
      if (body.password === 'provider-error') { res.statusCode = 422; return res.end(JSON.stringify({ code: 'unexpected_failure', msg: 'Provider error' })); }
      if (body.refresh_token) {
        refreshed++;
        if (!active) { res.statusCode = 400; return res.end(JSON.stringify({ error_code: 'refresh_token_not_found', msg: 'Revoked' })); }
      }
      if (body.password !== 'test-password' && body.refresh_token !== 'test-refresh-token') { res.statusCode = 400; return res.end(JSON.stringify({ error_code: 'invalid_credentials', msg: 'Invalid login credentials' })); }
      active = true;
      return res.end(JSON.stringify({ access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: body.refresh_token ? 3600 : 1, user: user() }));
    }
    if (req.url === '/auth/v1/user') {
      if (!active) { res.statusCode = 401; return res.end(JSON.stringify({ msg: 'Revoked' })); }
      return res.end(JSON.stringify(user()));
    }
    if (req.url.startsWith('/auth/v1/logout')) {
      assert.equal(req.url, '/auth/v1/logout?scope=local');
      revoked++; return res.end('{}');
    }
    res.statusCode = 404; res.end('{}');
  });
  auth.listen(0, '127.0.0.1'); await once(auth, 'listening');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'prensa-auth-'));
  let child;
  t.after(async () => { child?.kill(); auth.closeAllConnections(); auth.close(); await fs.rm(temp, { recursive: true, force: true }); });
  await fs.copyFile(path.join(__dirname, '../server.js'), path.join(temp, 'server.js'));
  await fs.copyFile(path.join(__dirname, '../content-model.js'), path.join(temp, 'content-model.js'));
  await fs.symlink(path.join(__dirname, '../node_modules'), path.join(temp, 'node_modules'));
  await fs.writeFile(path.join(temp, '.env'), 'PRIVATE=value');
  await fs.writeFile(path.join(temp, 'pagina-independiente_4.html'), '<h1>Prensa</h1>');
  const legacy = { diarios: [[], [], []], entrevistas: [], noticieros: [] };
  const content = require('../content-model').normalize(legacy);
  await fs.writeFile(path.join(temp, 'content.json'), JSON.stringify(legacy));
  const portServer = http.createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
  const port = portServer.address().port; await new Promise(resolve => portServer.close(resolve));
  child = spawn(process.execPath, ['server.js'], { cwd: temp, env: { ...process.env, PORT: String(port), SUPABASE_URL: `http://127.0.0.1:${auth.address().port}`, SUPABASE_PUBLISHABLE_KEY: 'test-key', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(Error('Server startup timeout')), 10000); child.stdout.once('data', () => { clearTimeout(timeout); resolve(); }); child.once('exit', code => { clearTimeout(timeout); reject(Error(`Server exited ${code}`)); }); });
  const base = `http://127.0.0.1:${port}`;
  const request = (url, method = 'GET', body, cookie) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = (password = 'test-password') => request('/api/login', 'POST', { email: 'admin@example.test', password });
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /img-src[^;]*blob:/, 'local image decoding is allowed by the browser policy');
  for (const file of ['/.env', '/server.js', '/package.json', '/content.json', '/node_modules/package.json', '/.git/config']) assert.equal((await request(file)).status, 404, file);
  assert.deepEqual(await (await request('/api/content')).json(), content, 'migrates legacy carousel structure');
  assert.equal((await request('/api/content', 'PUT', content)).status, 401);
  assert.equal((await request('/api/images', 'POST', {})).status, 401);
  const wrong = await login('wrong');
  assert.equal(wrong.status, 401);
  assert.match((await wrong.json()).error, /Supabase rechazó/);
  assert.equal((await login('provider-error')).status, 502, 'service errors are not credential errors');
  role = 'member'; assert.equal((await login()).status, 403, 'user_metadata cannot grant admin');
  role = 'admin';
  const signedIn = await login(); assert.equal(signedIn.status, 200);
  const cookieHeader = signedIn.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly/); assert.match(cookieHeader, /SameSite=Lax/);
  assert.doesNotMatch(cookieHeader, /test-access-token|test-refresh-token/);
  const cookie = cookieHeader.split(';')[0];
  assert.deepEqual(await signedIn.json(), { ok: true });
  assert.equal((await request('/api/content', 'PUT', content, cookie)).status, 200);
  assert.deepEqual(await (await request('/api/content')).json(), content);
  assert.ok(refreshed > 0, 'renews expiring Supabase sessions before saving');
  const upload = bytes => fetch(base + '/api/images', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'image/png' }, body: bytes });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVf8AAAAASUVORK5CYII=', 'base64');
  const uploaded = await upload(png); assert.equal(uploaded.status, 201);
  const imageUrl = (await uploaded.json()).url;
  const served = await request(imageUrl); assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
  assert.equal((await upload(Buffer.from('<svg onload="bad()"/>'))).status, 415);
  const large = Buffer.alloc(20 * 1024 * 1024); png.copy(large);
  assert.equal((await upload(large)).status, 201, 'accepts images up to 20 MiB');
  assert.equal((await upload(Buffer.alloc(20 * 1024 * 1024 + 1))).status, 413);
  const edited = structuredClone(content);
  edited.diarios = [];
  edited.entrevistas = [[{ imagenes: [imageUrl], texto: 'Entrevista', link: '', video: '' }], []];
  edited.noticieros = [[], [], [], []];
  edited.textos.titulo = 'Nuevo encabezado'; edited.textos.pie = 'Nuevo pie';
  assert.equal((await request('/api/content', 'PUT', edited, cookie)).status, 200);
  assert.deepEqual(await (await request('/api/content')).json(), edited);
  const bad = structuredClone(edited); bad.entrevistas[0][0].imagenes = ['javascript:alert(1)'];
  assert.equal((await request('/api/content', 'PUT', bad, cookie)).status, 400);
  assert.deepEqual(await (await request('/api/content')).json(), edited, 'invalid save leaves existing content intact');

  role = 'member'; assert.equal((await request('/api/content', 'PUT', content, cookie)).status, 401, 'role removal takes effect immediately');
  role = 'admin'; const next = (await login()).headers.get('set-cookie').split(';')[0];
  active = false; assert.equal((await request('/api/content', 'PUT', content, next)).status, 401);
  const last = (await login()).headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/logout', 'POST', {}, last)).status, 200);
  assert.ok(revoked >= 2);
  assert.equal((await request('/api/content', 'PUT', content, last)).status, 401);
});
