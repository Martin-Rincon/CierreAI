import fs from "node:fs";
import path from "node:path";
import { createClient, type Client, type InValue, type ResultSet, type Transaction } from "@libsql/client";

const dataDirectory = path.join(process.cwd(), "data");
export const databaseUrl = process.env.TURSO_DATABASE_URL?.trim() || "file:./data/cierreai.db";
export const databasePath = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : null;
const authToken = process.env.TURSO_AUTH_TOKEN?.trim();

if (!databasePath && !authToken) {
  throw new Error("Falta TURSO_AUTH_TOKEN para conectar con la base remota.");
}

if (databasePath) fs.mkdirSync(dataDirectory, { recursive: true });

type DatabaseGlobal = typeof globalThis & {
  __cierreAiClient?: Client;
  __cierreAiReady?: Promise<void>;
};

const databaseGlobal = globalThis as DatabaseGlobal;
const client = databaseGlobal.__cierreAiClient ?? createClient({
  url: databaseUrl,
  authToken: databasePath ? undefined : authToken,
});

if (process.env.NODE_ENV !== "production") databaseGlobal.__cierreAiClient = client;

export type DbExecutor = Pick<Client, "execute"> | Pick<Transaction, "execute">;

async function columns(table: string): Promise<string[]> {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  return result.rows.map((row) => String(row.name));
}

async function migrate(): Promise<void> {
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS cierres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL UNIQUE,
      efectivo_inicial INTEGER NOT NULL CHECK (efectivo_inicial >= 0),
      efectivo_contado INTEGER CHECK (efectivo_contado >= 0),
      total_esperado INTEGER NOT NULL DEFAULT 0,
      total_registrado INTEGER NOT NULL DEFAULT 0,
      diferencia INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'conciliado', 'con_diferencia', 'resuelto')),
      analizado INTEGER NOT NULL DEFAULT 0 CHECK (analizado IN (0, 1))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      medio_pago TEXT NOT NULL CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      conciliada INTEGER NOT NULL DEFAULT 0 CHECK (conciliada IN (0, 1)),
      metodo_carga TEXT NOT NULL CHECK (metodo_carga IN ('ia', 'formulario', 'csv')),
      submission_id TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      categoria TEXT NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      medio_pago TEXT NOT NULL CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      metodo_carga TEXT NOT NULL CHECK (metodo_carga IN ('ia', 'formulario', 'csv')),
      submission_id TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS movimientos_pago (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      medio_pago TEXT NOT NULL CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      conciliado INTEGER NOT NULL DEFAULT 0 CHECK (conciliado IN (0, 1)),
      metodo_carga TEXT NOT NULL CHECK (metodo_carga IN ('ia', 'formulario', 'csv')),
      submission_id TEXT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS causas_candidatas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('venta_sin_pago', 'pago_sin_venta', 'diferencia_efectivo', 'gasto_sospechoso')),
      referencia_tipo TEXT CHECK (referencia_tipo IS NULL OR referencia_tipo IN ('venta', 'movimiento_pago')),
      referencia_id INTEGER,
      monto INTEGER NOT NULL CHECK (monto >= 0),
      efecto INTEGER NOT NULL DEFAULT 0,
      tipo_match TEXT NOT NULL,
      explicacion_ia TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'confirmada', 'descartada'))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS idx_ventas_cierre_medio ON ventas(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_gastos_cierre_medio ON gastos(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_movimientos_cierre_medio ON movimientos_pago(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_causas_cierre ON causas_candidatas(cierre_id, estado);
  `);

  for (const table of ["ventas", "gastos", "movimientos_pago"]) {
    if (!(await columns(table)).includes("submission_id")) {
      await client.execute(`ALTER TABLE ${table} ADD COLUMN submission_id TEXT`);
    }
    await client.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_submission_id ON ${table}(submission_id) WHERE submission_id IS NOT NULL`);
  }
  if (!(await columns("cierres")).includes("analizado")) {
    await client.execute("ALTER TABLE cierres ADD COLUMN analizado INTEGER NOT NULL DEFAULT 0 CHECK (analizado IN (0, 1))");
  }
  if (!(await columns("cierres")).includes("finalizado_at")) {
    await client.execute("ALTER TABLE cierres ADD COLUMN finalizado_at TEXT");
  }
  if (!(await columns("cierres")).includes("es_demo")) {
    await client.execute("ALTER TABLE cierres ADD COLUMN es_demo INTEGER NOT NULL DEFAULT 0 CHECK (es_demo IN (0, 1))");
  }
  if (!(await columns("causas_candidatas")).includes("efecto")) {
    await client.execute("ALTER TABLE causas_candidatas ADD COLUMN efecto INTEGER NOT NULL DEFAULT 0");
    await client.execute(`UPDATE causas_candidatas SET efecto = CASE tipo
      WHEN 'venta_sin_pago' THEN -monto WHEN 'pago_sin_venta' THEN monto
      WHEN 'diferencia_efectivo' THEN (SELECT COALESCE(c.efectivo_contado, 0) - (c.efectivo_inicial
        + COALESCE((SELECT SUM(v.monto) FROM ventas v WHERE v.cierre_id = c.id AND v.medio_pago = 'efectivo'), 0)
        - COALESCE((SELECT SUM(g.monto) FROM gastos g WHERE g.cierre_id = c.id AND g.medio_pago = 'efectivo'), 0))
        FROM cierres c WHERE c.id = causas_candidatas.cierre_id) ELSE 0 END`);
  }
  await client.execute(`UPDATE cierres SET estado = CASE WHEN diferencia = 0 THEN 'conciliado'
    WHEN COALESCE((SELECT SUM(cc.efecto) FROM causas_candidatas cc WHERE cc.cierre_id = cierres.id AND cc.estado = 'confirmada'), 0) = diferencia THEN 'resuelto'
    ELSE 'con_diferencia' END`);
}

const ready = databaseGlobal.__cierreAiReady ?? migrate();
if (process.env.NODE_ENV !== "production") databaseGlobal.__cierreAiReady = ready;

export async function all<T>(sql: string, args: InValue[] = [], executor: DbExecutor = client): Promise<T[]> {
  await ready;
  const result = await executor.execute({ sql, args });
  return result.rows as unknown as T[];
}

export async function get<T>(sql: string, args: InValue[] = [], executor: DbExecutor = client): Promise<T | undefined> {
  return (await all<T>(sql, args, executor))[0];
}

export async function run(sql: string, args: InValue[] = [], executor: DbExecutor = client): Promise<ResultSet> {
  await ready;
  return executor.execute({ sql, args });
}

export async function transaction<T>(callback: (tx: DbExecutor) => Promise<T>): Promise<T> {
  await ready;
  const tx = await client.transaction("write");
  try {
    const result = await callback(tx);
    await tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}

export async function closeDatabase(): Promise<void> {
  await ready;
  client.close();
}
