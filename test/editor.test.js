const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const Model = require('../content-model');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('Editor: carruseles por sección, imágenes, textos y errores de guardado', async t => {
  const html = fs.readFileSync(require.resolve('../pagina-independiente_4.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'http://localhost:3000', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document, $ = id => d.getElementById(id);
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  let stored = Model.normalize({ diarios: [[{ imagenes: [image], texto: 'Original', link: '' }], [], []], entrevistas: [], noticieros: [] });
  let fail = false, uploaded = 0;
  w.structuredClone = structuredClone; w.confirm = () => true;
  w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
  w.Image = class { set src(value) { queueMicrotask(() => this.onload()); } };
  w.fetch = async (endpoint, options = {}) => {
    if (endpoint === '/api/images') { uploaded++; return { ok: true, json: async () => ({ url: '/uploads/test.png' }) }; }
    if (options.method === 'PUT') {
      if (fail) return { ok: false, json: async () => ({ error: 'La sesión venció.' }) };
      stored = JSON.parse(options.body); return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => structuredClone(stored) };
  };
  w.eval(fs.readFileSync(require.resolve('../content-model.js'), 'utf8'));
  w.eval(fs.readFileSync(require.resolve('../editor.js'), 'utf8')); await tick();
  const select = async type => { d.querySelector(`[data-tipo="${type}"]`).click(); await tick(); };
  const count = () => d.querySelectorAll('[data-carrusel]').length;
  assert.deepEqual(Array.from(d.querySelectorAll('[data-tipo]')).slice(0, 3).map(n => n.dataset.tipo), ['diarios', 'entrevistas', 'noticieros']);
  assert.equal(count(), 3);
  assert.equal(d.querySelector('#grid-diarios [data-carousel]').classList.contains('carrusel-unico'), true, 'one card gets centered layout');
  assert.equal(d.querySelector('#grid-diarios img').getAttribute('src'), image, 'saved data images display');
  for (const type of ['entrevistas', 'noticieros', 'diarios']) {
    await select(type); const initial = count();
    assert.equal(initial, type === 'diarios' ? 3 : 1);
    $('agregar-carrusel').click(); await tick(); assert.equal(count(), initial + 1);
    assert.equal(d.querySelectorAll(`#grid-${type} [data-carousel]`).length, initial + 1);
    $('eliminar-carrusel').click(); await tick(); assert.equal(count(), initial);
  }
  await select('entrevistas');
  $('eliminar-carrusel').click(); await tick(); assert.equal(count(), 0); assert.equal($('form-item-admin').hidden, true);
  $('agregar-carrusel').click(); await tick(); assert.equal(count(), 1); assert.equal($('form-item-admin').hidden, false);
  assert.equal($('campo-video-admin').hidden, true);
  await select('noticieros'); assert.equal($('campo-video-admin').hidden, false);
  await select('diarios');
  Object.defineProperty($('input-imagen-archivo'), 'files', { configurable: true, value: [new w.File(['png'], 'portada.png', { type: 'image/png' })] });
  $('input-imagen-archivo').dispatchEvent(new w.Event('change')); await tick(); await tick();
  assert.equal(uploaded, 1); assert.equal($('input-imagen-url').value, '/uploads/test.png');
  assert.equal(d.querySelector('#vista-previa-imagenes img').getAttribute('src'), '/uploads/test.png');
  $('input-texto-admin').value = 'Nueva tarjeta';
  $('form-item-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(stored.diarios[0].length, 2);
  assert.equal(d.querySelectorAll('#grid-diarios [data-track]')[0].children.length, 6, 'two cards repeat visually in the loop');
  fail = true; $('input-texto-admin').value = 'No debe guardarse'; $('input-imagen-url').value = '/uploads/test.png';
  $('form-item-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(stored.diarios[0].length, 2); assert.equal($('input-texto-admin').value, 'No debe guardarse'); assert.match($('estado-editor').textContent, /sesión venció/);
  fail = false;
  await select('encabezado'); assert.equal($('editor-tarjetas').hidden, true); assert.equal($('form-textos-admin').hidden, false);
  $('input-titulo').value = '<b>Nuevo título</b>'; $('input-introduccion').value = 'Introducción nueva'; $('input-lema').value = 'Nuevo lema';
  $('form-textos-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal($('texto-titulo').textContent, '<b>Nuevo título</b>'); assert.equal($('texto-titulo').children.length, 0);
  await select('pie'); $('input-pie').value = 'Nuevo pie\nSegunda línea';
  $('form-textos-admin').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick();
  assert.equal(stored.textos.pie, 'Nuevo pie\nSegunda línea'); assert.equal($('texto-pie').textContent, stored.textos.pie);
  await select('entrevistas'); assert.equal(count(), 1);
});
