# Información Global

## Configuración local

Requiere Node.js 22 o posterior.

1. Ejecutá `npm ci`.
2. Copiá `.env.example` como `.env`.
3. Configurá `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` con los valores de `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` de `web-acserp`.
4. Ejecutá `npm start` y abrí http://localhost:3000/.

## Acceso editorial

Al pie de la página, seleccioná **Acceso editorial** e ingresá con el mismo correo y contraseña de administrador de la web de ACSERP. Supabase debe asignar al usuario `app_metadata.role = "admin"`, igual que en `web-acserp`. Los usuarios sin ese rol no pueden acceder. No se usa `user_metadata` para autorizar.

Ambos sitios comparten la cuenta y la contraseña, pero mantienen sesiones independientes: iniciar sesión en uno no abre automáticamente el otro. Para recuperar la contraseña, usá la opción de recuperación de la web de ACSERP.

La contraseña se valida en Supabase. Los tokens quedan en memoria del servidor; el navegador recibe una cookie `HttpOnly`, `SameSite=Lax`, con duración máxima de 8 horas. Cada guardado vuelve a consultar el usuario y su rol en Supabase, y el cliente renueva los tokens cuando corresponde. Reiniciar el servidor requiere volver a ingresar. Cerrar sesión revoca únicamente la sesión de prensa.

Las noticias siguen guardándose en `content.json` de este proyecto; no se mezclan con el contenido de `web-acserp`. La API de escritura exige sesión y valida tamaños y estructura. El servidor no publica `.env`, archivos del backend ni dependencias.

En producción, usá HTTPS y `NODE_ENV=production` para la cookie `Secure`, variables de entorno del hosting y almacenamiento persistente con copias de seguridad.

## Verificación

`npm test` prueba el flujo HTTP contra un servicio Auth simulado: inicio de sesión, roles, guardado, revocación de permisos, cierre de sesión y protección de archivos privados. No usa ni modifica cuentas reales.

## Editor de contenido

Las pestañas siguen el orden de la página: Diarios, Entrevistas y Noticieros. Cada sección permite agregar o eliminar carruseles (hasta 20 por sección y 100 tarjetas por carrusel). Eliminar un carrusel pide confirmación y elimina sus tarjetas de la página. Se puede dejar una sección sin carruseles. Los datos anteriores se adaptan al abrirlos sin perder tarjetas ni imágenes.

Encabezado permite editar el título de bienvenida, la introducción y el lema junto al logo. Pie de página modifica el texto sobre Acceso editorial. Los textos se guardan como texto plano.

### Imágenes y campos de las tarjetas

- **Subir imágenes:** elegí JPG, PNG, WebP o GIF, hasta 20 MB por archivo y 20 imágenes por tarjeta. Se guardan en `uploads/`; esperá la vista previa y luego guardá la tarjeta. HEIC, SVG y PDF no son imágenes admitidas: exportalos como JPG o PNG.
- **Direcciones de las imágenes:** una por renglón. La subida completa este campo; también admite URLs públicas directas o rutas de archivos ya presentes en el proyecto. Una ruta de tu dispositivo o una página de Canva/Drive no sube una imagen. Los enlaces externos dependen de los permisos y disponibilidad del sitio de origen. La primera imagen es la portada; los botones numerados permiten ver las demás.
- **Enlace al contenido completo:** destino opcional que se abre al tocar la tarjeta (noticia, PDF, YouTube, etc.). Es independiente de la portada; escribir un nombre de archivo no lo sube.
- **Video de previsualización:** solo en Noticieros, enlace directo a MP4, opcional. Se reproduce hasta 5 segundos al pasar el mouse o enfocar la tarjeta.
- **Texto de la tarjeta:** descripción obligatoria de hasta 2000 caracteres.

Las imágenes antiguas incrustadas siguen funcionando. Las nuevas se guardan separadas para evitar inflar `content.json`. El contenido tiene un límite de 32 MB por guardado. Conservar tanto `content.json` como `uploads/` en el almacenamiento persistente y las copias de seguridad. Quitar una imagen de una tarjeta no borra su archivo del servidor, porque otras tarjetas podrían usarlo.
