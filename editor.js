(() => {
  const { TYPES, normalize, safeUrl, valid } = window.ContentModel;
  const $ = id => document.getElementById(id);
  const labels = { diarios: 'Ver diario', entrevistas: 'Ver entrevista', noticieros: 'Ver más' };
  let carouselCleanups = [];
  let contenido, tipo = 'diarios', carrusel = 0, editando = null, busy = false;
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const url = (value, image = false) => safeUrl(value || '', image) ? escape(value) : '';
  const imageList = () => $('input-imagen-url').value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const status = (message = '', error = false) => { $('estado-editor').textContent = message; $('estado-editor').classList.toggle('error', error); };
  function setBusy(value) {
    busy = value;
    $('overlay-panel-admin').querySelectorAll('button, input, textarea').forEach(node => { node.disabled = value; });
    if (!value) { $('eliminar-carrusel').disabled = !TYPES.includes(tipo) || !contenido[tipo].length; $('agregar-carrusel').disabled = TYPES.includes(tipo) && contenido[tipo].length >= 20; }
  }
  async function api(endpoint, options = {}) {
    const response = await fetch(endpoint, { credentials: 'same-origin', ...options });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'No se pudo completar la operación.');
    return result;
  }
  async function save(change) {
    if (busy) return false;
    const next = structuredClone(contenido); change(next);
    if (!valid(next)) { status('Revisá los campos: hasta 20 carruseles por sección, 100 tarjetas por carrusel y 20 imágenes por tarjeta.', true); return false; }
    setBusy(true); status('Guardando…');
    try {
      await api('/api/content', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) });
      contenido = next; renderPage(); status('Cambios guardados.'); return true;
    } catch (error) { status(error.message, true); return false; }
    finally { setBusy(false); }
  }
  function gallery(item) {
    const images = item.imagenes || [];
    return `<img src="${url(images[0], true)}" alt="Portada" loading="lazy" decoding="async">`;
  }
  function card(item, type) {
    const preview = type === 'noticieros' && item.video ? `<video muted playsinline preload="none" data-preview-video src="${url(item.video)}"></video>` : '';
    const link = `<a href="${url(item.link || '#')}"${item.link ? ' target="_blank" rel="noopener noreferrer"' : ''}`;
    const controls = item.imagenes.length > 1 ? `<div class="galeria-controles">${item.imagenes.map((src, i) => `<button type="button" data-image="${url(src, true)}" aria-label="Ver imagen ${i + 1}">${i + 1}</button>`).join('')}</div>` : '';
    if (type === 'entrevistas') return `<article class="tarjeta-entrevista"><div class="tarjeta-entrevista__preview">${gallery(item)}<span class="tarjeta-entrevista__badge">Vista previa</span></div>${controls}<div class="tarjeta-entrevista__info"><div><h3>${escape(item.texto)}</h3><time class="fecha">Septiembre, 2026</time></div>${link} class="boton-acceso">Ver entrevista ↗</a></div></article>`;
    return `<article class="tarjeta-recurso">${link} class="tarjeta-recurso__imagen"><div class="noticiero-preview${preview ? ' con-video' : ''}">${gallery(item)}${preview}</div><span class="tarjeta-recurso__enlace">${labels[type]} ↗</span></a>${controls}<p class="tarjeta-recurso__descripcion">${escape(item.texto)}</p></article>`;
  }
  function initCarousel(wrapper) {
    const track = wrapper.querySelector('[data-track]');
    const originals = Array.from(track.querySelectorAll('article'));
    const count = originals.length;
    wrapper.classList.toggle('carrusel-unico', count <= 1);
    wrapper.querySelectorAll('[data-prev], [data-next]').forEach(button => { button.hidden = count <= 1; });
    if (count <= 1) return;
    // Tres vueltas visuales conservan el bucle, incluso con solo dos tarjetas.
    const before = document.createDocumentFragment(), after = document.createDocumentFragment();
    originals.forEach(card => { before.append(card.cloneNode(true)); after.append(card.cloneNode(true)); });
    track.prepend(before); track.append(after);
    const cards = Array.from(track.children);
    let span = 0, firstCenter = 0, frame = 0, timer;
    const center = card => card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2;
    const focus = () => {
      frame = 0;
      const middle = track.scrollLeft + track.clientWidth / 2;
      cards.forEach(card => {
        const distance = Math.abs(middle - (card.offsetLeft + card.offsetWidth / 2));
        const normalized = Math.min(distance / (track.clientWidth / 2 || 1), 1);
        card.style.opacity = String(1 - normalized * .7);
        card.style.filter = `blur(${(normalized * 4).toFixed(1)}px)`;
        card.style.transform = `scale(${(1 - normalized * .14).toFixed(3)})`;
      });
    };
    const jump = left => {
      const behavior = track.style.scrollBehavior, snap = track.style.scrollSnapType;
      track.style.scrollBehavior = 'auto'; track.style.scrollSnapType = 'none';
      track.scrollLeft = left;
      track.style.scrollBehavior = behavior; track.style.scrollSnapType = snap;
      focus();
    };
    const layout = () => {
      if (!track.clientWidth) return;
      span = cards[count].offsetLeft - cards[0].offsetLeft;
      firstCenter = center(cards[count]);
      jump(firstCenter);
    };
    const step = () => cards[1].offsetLeft - cards[0].offsetLeft;
    track.addEventListener('scroll', () => {
      if (!frame) frame = requestAnimationFrame(focus);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!span) return;
        if (track.scrollLeft < firstCenter - step() / 2) jump(track.scrollLeft + span);
        else if (track.scrollLeft >= firstCenter + span - step() / 2) jump(track.scrollLeft - span);
      }, 140);
    }, { passive: true });
    wrapper.querySelector('[data-prev]').onclick = () => track.scrollBy({ left: -step(), behavior: 'smooth' });
    wrapper.querySelector('[data-next]').onclick = () => track.scrollBy({ left: step(), behavior: 'smooth' });
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(layout) : null;
    observer?.observe(track);
    layout();
    carouselCleanups.push(() => { observer?.disconnect(); clearTimeout(timer); cancelAnimationFrame(frame); });
  }
  function renderPage() {
    carouselCleanups.forEach(cleanup => cleanup()); carouselCleanups = [];
    for (const key of ['titulo', 'introduccion', 'lema', 'pie']) $('texto-' + key).textContent = contenido.textos[key];
    for (const type of TYPES) {
      const container = $('grid-' + type); container.className = type === 'entrevistas' ? '' : 'carrusel-diarios';
      container.innerHTML = contenido[type].map((group, index) => {
        const interview = type === 'entrevistas';
        const wrapper = interview ? 'carrusel-envoltorio' : 'diario-carrusel';
        const arrow = interview ? 'carrusel-flecha' : 'diario-carrusel__flecha';
        return `<div class="${wrapper}" data-carousel data-diario="${type}" aria-label="${type}, carrusel ${index + 1}"><button type="button" class="${arrow} ${arrow}--prev" data-prev aria-label="Anterior">‹</button><div class="${interview ? 'carrusel-entrevistas' : 'diario-carrusel__pista'}" data-dinamico="true" data-track>${group.length ? group.map(item => card(item, type)).join('') : '<p class="tarjeta-recurso__descripcion">Todavía no hay publicaciones en este carrusel.</p>'}</div><button type="button" class="${arrow} ${arrow}--next" data-next aria-label="Siguiente">›</button></div>`;
      }).join('');
      container.querySelectorAll('[data-carousel]').forEach(initCarousel);
      container.querySelectorAll('[data-image]').forEach(button => { button.onclick = () => { button.closest('article').querySelector('img').src = button.dataset.image; }; });
      container.querySelectorAll('[data-preview-video]').forEach(video => {
        const article = video.closest('article');
        const stop = () => { video.pause(); video.currentTime = 0; };
        article.onmouseenter = article.onfocusin = () => { video.currentTime = 0; video.play().catch(() => {}); };
        article.onmouseleave = article.onfocusout = stop;
        video.ontimeupdate = () => { if (video.currentTime >= 5) stop(); };
      });
    }
  }
  function previews() {
    const list = imageList();
    $('vista-previa-imagenes').innerHTML = list.map((src, i) => `<figure><img src="${url(src, true)}" alt="Imagen ${i + 1}"><figcaption>Imagen ${i + 1}</figcaption><button type="button" data-remove-image="${i}">Quitar</button></figure>`).join('');
    $('vista-previa-imagenes').querySelectorAll('img').forEach(img => { img.onerror = () => { img.nextElementSibling.textContent = 'No se pudo cargar. Revisá que el enlace sea público y directo.'; }; });
    $('vista-previa-imagenes').querySelectorAll('button').forEach(button => { button.onclick = () => { const images = imageList(); images.splice(Number(button.dataset.removeImage), 1); $('input-imagen-url').value = images.join('\n'); previews(); }; });
  }
  function resetForm() {
    $('form-item-admin').reset(); editando = null;
    $('titulo-form-item').textContent = 'Agregar nueva tarjeta';
    $('boton-guardar-item').textContent = 'Agregar tarjeta';
    $('boton-cancelar-edicion').hidden = true; previews();
  }
  function renderEditor() {
    const cards = TYPES.includes(tipo);
    $('editor-tarjetas').hidden = !cards; $('form-textos-admin').hidden = cards;
    $('campos-encabezado').hidden = tipo !== 'encabezado'; $('campos-pie').hidden = tipo !== 'pie';
    if (!cards) { for (const key of ['titulo', 'introduccion', 'lema', 'pie']) $('input-' + key).value = contenido.textos[key]; return; }
    const groups = contenido[tipo]; carrusel = Math.max(0, Math.min(carrusel, groups.length - 1));
    $('pestanias-carruseles').innerHTML = groups.map((group, i) => `<button type="button" class="pestania-admin" data-carrusel="${i}" aria-pressed="${i === carrusel}">Carrusel ${i + 1} (${group.length})</button>`).join('') || '<p>No hay carruseles. Agregá uno para empezar.</p>';
    $('pestanias-carruseles').querySelectorAll('button').forEach(button => { button.onclick = () => { carrusel = Number(button.dataset.carrusel); resetForm(); renderEditor(); status(); }; });
    $('form-item-admin').hidden = !groups.length;
    $('campo-video-admin').hidden = tipo !== 'noticieros';
    $('eliminar-carrusel').disabled = !groups.length; $('agregar-carrusel').disabled = groups.length >= 20;
    const items = groups[carrusel] || [];
    $('lista-items-admin').innerHTML = items.map((item, i) => `<div class="item-admin"><img src="${url(item.imagenes[0], true)}" alt=""><div class="item-admin__texto">${escape(item.texto)}</div><div class="item-admin__acciones"><button type="button" class="boton-admin boton-admin--secundario" data-edit="${i}">Editar</button><button type="button" class="boton-admin boton-admin--peligro" data-delete="${i}">Eliminar</button></div></div>`).join('');
    $('lista-items-admin').querySelectorAll('[data-edit]').forEach(button => { button.onclick = () => {
      resetForm(); editando = Number(button.dataset.edit); const item = items[editando];
      $('input-imagen-url').value = item.imagenes.join('\n'); $('input-video-admin').value = item.video || ''; $('input-link-admin').value = item.link || ''; $('input-texto-admin').value = item.texto;
      $('titulo-form-item').textContent = 'Editando tarjeta'; $('boton-guardar-item').textContent = 'Guardar cambios'; $('boton-cancelar-edicion').hidden = false; previews();
    }; });
    $('lista-items-admin').querySelectorAll('[data-delete]').forEach(button => { button.onclick = async () => {
      if (!confirm('¿Eliminar esta tarjeta?')) return;
      if (await save(next => next[tipo][carrusel].splice(Number(button.dataset.delete), 1))) { resetForm(); renderEditor(); }
    }; });
  }
  document.querySelectorAll('[data-tipo]').forEach(button => { button.onclick = () => {
    tipo = button.dataset.tipo; carrusel = 0; resetForm(); status();
    document.querySelectorAll('[data-tipo]').forEach(tab => tab.setAttribute('aria-selected', String(tab === button)));
    renderEditor();
  }; });
  $('agregar-carrusel').onclick = async () => { if (await save(next => next[tipo].push([]))) { carrusel = contenido[tipo].length - 1; resetForm(); renderEditor(); } };
  $('eliminar-carrusel').onclick = async () => {
    if (!contenido[tipo].length || !confirm(`¿Eliminar el carrusel ${carrusel + 1} y sus ${contenido[tipo][carrusel].length} tarjetas?`)) return;
    if (await save(next => next[tipo].splice(carrusel, 1))) { resetForm(); renderEditor(); }
  };
  $('input-imagen-url').oninput = previews;
  $('input-imagen-archivo').onchange = async () => {
    const files = Array.from($('input-imagen-archivo').files); if (!files.length) return;
    if (files.length + imageList().length > 20) { status('Podés agregar hasta 20 imágenes por tarjeta.', true); return; }
    if (files.some(file => file.size > 20 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type))) { status('Usá JPG, PNG, WebP o GIF de hasta 20 MB por archivo.', true); return; }
    setBusy(true); status('Subiendo imágenes…');
    try {
      for (const file of files) {
        const image = new Image(); const local = URL.createObjectURL(file);
        try { await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('El archivo no se puede abrir como imagen.')); image.src = local; }); }
        finally { URL.revokeObjectURL(local); }
        const result = await api('/api/images', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        $('input-imagen-url').value = [...imageList(), result.url].join('\n');
      }
      status('Imágenes subidas. Guardá la tarjeta para publicarlas.');
    } catch (error) { status(error.message, true); }
    finally { $('input-imagen-archivo').value = ''; previews(); setBusy(false); }
  };
  $('boton-cancelar-edicion').onclick = resetForm;
  $('form-item-admin').onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    const images = imageList(), text = $('input-texto-admin').value.trim();
    if (!images.length || !text) { status('Agregá al menos una imagen y el texto de la tarjeta.', true); return; }
    if (images.some(src => !safeUrl(src, true)) || !safeUrl($('input-link-admin').value.trim()) || !safeUrl($('input-video-admin').value.trim())) { status('Usá direcciones públicas o archivos del proyecto. No se admiten rutas de tu computadora.', true); return; }
    const item = { imagenes: images, texto: text, link: $('input-link-admin').value.trim(), video: tipo === 'noticieros' ? $('input-video-admin').value.trim() : '' };
    if (await save(next => { if (editando === null) next[tipo][carrusel].push(item); else next[tipo][carrusel][editando] = item; })) { resetForm(); renderEditor(); }
  };
  $('form-textos-admin').onsubmit = async event => {
    event.preventDefault(); await save(next => { for (const key of tipo === 'pie' ? ['pie'] : ['titulo', 'introduccion', 'lema']) next.textos[key] = $('input-' + key).value; });
  };
  $('boton-abrir-admin').onclick = () => { $('overlay-login-admin').classList.add('abierto'); $('input-correo-admin').focus(); };
  document.querySelectorAll('[data-cerrar-admin]').forEach(button => { button.onclick = () => { $('overlay-login-admin').classList.remove('abierto'); $('overlay-panel-admin').classList.remove('abierto'); }; });
  $('form-login-admin').onsubmit = async event => {
    event.preventDefault(); $('error-login-admin').textContent = '';
    try {
      await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('input-correo-admin').value, password: $('input-clave-admin').value }) });
      contenido = normalize(await api('/api/content')); renderPage();
      $('input-clave-admin').value = ''; $('overlay-login-admin').classList.remove('abierto'); $('overlay-panel-admin').classList.add('abierto'); resetForm(); renderEditor();
    } catch (error) { $('error-login-admin').textContent = error.message; }
  };
  $('boton-cerrar-sesion-admin').onclick = async () => {
    try { await api('/api/logout', { method: 'POST' }); $('overlay-panel-admin').classList.remove('abierto'); } catch (error) { status(error.message, true); }
  };
  api('/api/content').then(data => { contenido = normalize(data); renderPage(); renderEditor(); }).catch(() => { $('error-login-admin').textContent = 'No se pudo cargar el contenido. Recargá la página antes de editar.'; });
})();
