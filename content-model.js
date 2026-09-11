(function (root) {
  const TYPES = ['diarios', 'entrevistas', 'noticieros'];
  const defaults = { titulo: 'Bienvenidos a Información Global', introduccion: 'Poronga un espacio de cobertura mundial pensado para acercarles, de forma simple, la actualidad internacional. Van a encontrar diarios con la información completa de cada tema, entrevistas en video a especialistas y protagonistas, una sección Top Secret con documentos reservados, y noticieros con el resumen audiovisual de la semana. Usen los botones del encabezado para moverse directamente a cada sección.', lema: 'Veritas nunquam perit', pie: 'INFORMACIÓN GLOBAL · COBERTURA MUNDIAL · Septiembre, 2026 · Contenido editorial de solo lectura' };
  function normalize(value) {
    const result = { ...value, version: 2, textos: { ...defaults, ...value.textos } };
    for (const type of TYPES) {
      const groups = value[type] || [];
      result[type] = value.version === 2 || groups.some(Array.isArray) ? groups : [groups];
    }
    return result;
  }
  function safeUrl(value, image = false) {
    if (typeof value !== 'string' || value.length > 4000000 || /[\u0000-\u001f\u007f]/.test(value)) return false;
    if (!value) return true;
    if (image && /^data:image\/(png|jpeg|gif|webp|avif);base64,[a-z0-9+/]+=*$/i.test(value)) return true;
    if (/^(javascript|vbscript|data|file):/i.test(value) || value.startsWith('//') || value.includes('\\')) return false;
    return /^https?:\/\//i.test(value) || !/^[a-z][a-z0-9+.-]*:/i.test(value);
  }
  function valid(value) {
    if (!value || value.version !== 2 || !value.textos) return false;
    const limits = { titulo: 200, introduccion: 10000, lema: 200, pie: 2000 };
    if (!Object.entries(limits).every(([key, limit]) => typeof value.textos[key] === 'string' && value.textos[key].length <= limit)) return false;
    return TYPES.every(type => Array.isArray(value[type]) && value[type].length <= 20 && value[type].every(group => Array.isArray(group) && group.length <= 100 && group.every(item => item && Array.isArray(item.imagenes) && item.imagenes.length <= 20 && item.imagenes.every(image => safeUrl(image, true)) && safeUrl(item.link || '') && safeUrl(item.video || '') && typeof item.texto === 'string' && item.texto.length <= 2000)));
  }
  const api = { TYPES, defaults, normalize, safeUrl, valid };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ContentModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
