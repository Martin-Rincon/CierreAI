# CierreAI

Aplicación para cargar movimientos de caja, conciliar lo esperado con lo registrado y revisar evidencia calculada por un motor determinístico. Gemini es opcional y se usa únicamente en el servidor; nunca decide el resultado.

## Desarrollo local

Requiere Node.js 24 o superior y npm.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Abrí `http://localhost:3000`. Sin variables de Turso, `@libsql/client` usa automáticamente `file:./data/cierreai.db`. El archivo y `.env.local` están ignorados por Git.

## Desarrollo y producción con Turso

Creá `.env.local` con los datos de tu base remota:

```dotenv
TURSO_DATABASE_URL=libsql://nombre-base-organizacion.turso.io
TURSO_AUTH_TOKEN=tu_token
GEMINI_API_KEY=tu_clave
```

`TURSO_DATABASE_URL` selecciona la base remota. `TURSO_AUTH_TOKEN` autentica la conexión y nunca debe exponerse con `NEXT_PUBLIC_`. `GEMINI_API_KEY` sigue siendo opcional. Al iniciar, la aplicación crea o actualiza el schema necesario.

## Demo de 2 minutos

1. En el cierre de hoy, tocá **Cargar escenario demo** y confirmá si ya hay movimientos.
2. Verificá la diferencia general de **-$12.500**.
3. Tocá **Analizar diferencia**.
4. Abrí **Ver evidencia** en la venta de $12.500 sin pago.
5. Tocá **Confirmar causa** para mostrar **Diferencia explicada** sin ocultar la diferencia original.
6. Para repetir, tocá **Restablecer escenario demo**.

La demo reemplaza únicamente el cierre actual. Inserta movimientos mediante libSQL, pero no crea causas, no marca coincidencias y no ejecuta el análisis.

## Verificaciones

```bash
npm run typecheck
npm run lint
npm run build
npm run test:ia
npm run test:conciliacion
npm run test:idempotency
```

## Deploy previsto

No se realizó ningún deploy. Producción requiere una base Turso remota persistente: el fallback `file:` es exclusivamente para desarrollo local, porque el filesystem de Vercel no es persistente.

Antes del deploy, configurá `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` y, opcionalmente, `GEMINI_API_KEY` en Vercel. No versionar secretos ni archivos de `data/`.
Deploy de produccion verificado en vercel

Prueba de integracion GitHub-Vercel 2.
