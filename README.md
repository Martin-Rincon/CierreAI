# CierreAI

Aplicación para cargar movimientos de caja, conciliar lo esperado con lo registrado y revisar evidencia calculada por un motor determinístico. Gemini es opcional y se usa únicamente en el servidor; nunca decide el resultado.

## Desarrollo local

Requiere Node.js 24 o superior y npm.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Abrí `http://localhost:3000`. SQLite se crea en `data/cierreai.db`; ese archivo y `.env.local` están ignorados por Git. La app funciona sin IA. Para habilitarla, configurá solo en el servidor:

```dotenv
GEMINI_API_KEY=tu_clave
```

## Demo de 2 minutos

1. En el cierre de hoy, tocá **Cargar escenario demo** y confirmá si ya hay movimientos.
2. Verificá la diferencia general de **-$12.500**.
3. Tocá **Analizar diferencia**.
4. Abrí **Ver evidencia** en la venta de $12.500 sin pago.
5. Tocá **Confirmar causa** para mostrar **Diferencia explicada** sin ocultar la diferencia original.
6. Para repetir, tocá **Restablecer escenario demo**.

La demo reemplaza únicamente el cierre actual. Inserta movimientos en SQLite, pero no crea causas, no marca coincidencias y no ejecuta el análisis.

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

No se realizó ningún deploy. La implementación usa `node:sqlite` con `data/cierreai.db`. Es adecuada para desarrollo y demo local, pero no como persistencia en Vercel serverless: el sistema de archivos de una función es efímero y las instancias no comparten el archivo.

Antes de publicar hay que confirmar una migración mínima a una base remota apta para serverless. El motor determinístico puede conservarse. Luego se configurará `GEMINI_API_KEY` como variable opcional del proveedor, se ejecutarán todas las verificaciones y se desplegará con runtime Node.js. No versionar secretos ni archivos de `data/`.
