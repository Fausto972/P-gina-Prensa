# Información Global

## Configuración local

1. Copiá `.env.example` como `.env`.
2. Generá un hash para la contraseña:

```powershell
npm run hash-password -- "UnaClaveLargaYUnica"
```

3. Pegá el resultado en `ADMIN_PASSWORD_HASH` y reemplazá `SESSION_SECRET` por un valor aleatorio de al menos 32 caracteres.
4. Iniciá el servidor:

```powershell
npm start
```

Abrí <http://localhost:3000/>. No abras el HTML con doble clic: el panel y la API necesitan pasar por el servidor.

## Seguridad incluida

- La contraseña no está en el HTML ni en el cliente; se valida con `scrypt`.
- La sesión usa una cookie `HttpOnly`, `SameSite=Lax`, con expiración de 8 horas.
- La API de escritura exige sesión y valida la estructura y tamaños del contenido.
- Hay límite temporal de intentos de login por dirección IP.
- El contenido se guarda en `content.json` en el servidor.

Para producción, usá HTTPS, variables de entorno del proveedor y un almacenamiento persistente con copias de seguridad.
