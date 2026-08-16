# CierreAI

Aplicación local para detectar diferencias en el cierre de caja de un comercio.

## Requisitos

- Node.js 24 o superior
- npm

## Desarrollo

```bash
npm install
npm run dev
```

La aplicación queda disponible en `http://localhost:3000`.

La base SQLite se crea automáticamente en `data/cierreai.db`. En el primer arranque se carga el día de demostración.

## Volver a sembrar los datos de ejemplo

1. Detener el servidor de desarrollo.
2. Borrar la carpeta `data/` completa.
3. Volver a ejecutar `npm run dev`.

La base y el seed se regeneran automáticamente. La carpeta `data/` no se versiona.

## Funciones de IA

La app funciona localmente sin configurar IA. En la etapa correspondiente, la clave opcional se configurará en `.env.local`:

```dotenv
AI_GATEWAY_API_KEY=
```

Nunca se debe versionar una clave real.
