import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

const dataDirectory = path.join(process.cwd(), "data");
const databasePath = path.join(dataDirectory, "cierreai.db");

type DatabaseGlobal = typeof globalThis & {
  __cierreAiDatabase?: DatabaseSync;
};

function openDatabase(): DatabaseSync {
  fs.mkdirSync(dataDirectory, { recursive: true });

  const database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  return database;
}

const databaseGlobal = globalThis as DatabaseGlobal;
const database = databaseGlobal.__cierreAiDatabase ?? openDatabase();

if (process.env.NODE_ENV !== "production") {
  databaseGlobal.__cierreAiDatabase = database;
}

function migrate(): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS cierres (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL UNIQUE,
      efectivo_inicial INTEGER NOT NULL CHECK (efectivo_inicial >= 0),
      efectivo_contado INTEGER CHECK (efectivo_contado >= 0),
      total_esperado INTEGER NOT NULL DEFAULT 0,
      total_registrado INTEGER NOT NULL DEFAULT 0,
      diferencia INTEGER NOT NULL DEFAULT 0,
      estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'conciliado', 'con_diferencia', 'resuelto'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS ventas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      medio_pago TEXT NOT NULL
        CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      conciliada INTEGER NOT NULL DEFAULT 0 CHECK (conciliada IN (0, 1)),
      metodo_carga TEXT NOT NULL
        CHECK (metodo_carga IN ('ia', 'formulario', 'csv'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS gastos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      categoria TEXT NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      medio_pago TEXT NOT NULL
        CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      metodo_carga TEXT NOT NULL
        CHECK (metodo_carga IN ('ia', 'formulario', 'csv'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS movimientos_pago (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      monto INTEGER NOT NULL CHECK (monto > 0),
      medio_pago TEXT NOT NULL
        CHECK (medio_pago IN ('efectivo', 'transferencia', 'mercado_pago')),
      hora TEXT NOT NULL CHECK (hora GLOB '[0-2][0-9]:[0-5][0-9]'),
      conciliado INTEGER NOT NULL DEFAULT 0 CHECK (conciliado IN (0, 1)),
      metodo_carga TEXT NOT NULL
        CHECK (metodo_carga IN ('ia', 'formulario', 'csv'))
    ) STRICT;

    CREATE TABLE IF NOT EXISTS causas_candidatas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cierre_id INTEGER NOT NULL REFERENCES cierres(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (
        tipo IN ('venta_sin_pago', 'pago_sin_venta', 'diferencia_efectivo', 'gasto_sospechoso')
      ),
      referencia_tipo TEXT CHECK (
        referencia_tipo IS NULL OR referencia_tipo IN ('venta', 'movimiento_pago')
      ),
      referencia_id INTEGER,
      monto INTEGER NOT NULL CHECK (monto >= 0),
      tipo_match TEXT NOT NULL,
      explicacion_ia TEXT,
      estado TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (estado IN ('pendiente', 'confirmada', 'descartada'))
    ) STRICT;

    CREATE INDEX IF NOT EXISTS idx_ventas_cierre_medio
      ON ventas(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_gastos_cierre_medio
      ON gastos(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_movimientos_cierre_medio
      ON movimientos_pago(cierre_id, medio_pago, hora);
    CREATE INDEX IF NOT EXISTS idx_causas_cierre
      ON causas_candidatas(cierre_id, estado);
  `);

  for (const table of ["ventas", "gastos", "movimientos_pago"]) {
    const columns = database.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((column) => column.name === "submission_id")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN submission_id TEXT`);
    }
    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_${table}_submission_id
       ON ${table}(submission_id) WHERE submission_id IS NOT NULL`,
    );
  }

  const cierreColumns = database.prepare("PRAGMA table_info(cierres)").all() as { name: string }[];
  if (!cierreColumns.some((column) => column.name === "analizado")) {
    database.exec("ALTER TABLE cierres ADD COLUMN analizado INTEGER NOT NULL DEFAULT 0 CHECK (analizado IN (0, 1))");
  }

  const causaColumns = database.prepare("PRAGMA table_info(causas_candidatas)").all() as { name: string }[];
  if (!causaColumns.some((column) => column.name === "efecto")) {
    database.exec("ALTER TABLE causas_candidatas ADD COLUMN efecto INTEGER NOT NULL DEFAULT 0");
    database.exec(`
      UPDATE causas_candidatas SET efecto = CASE tipo
        WHEN 'venta_sin_pago' THEN -monto
        WHEN 'pago_sin_venta' THEN monto
        WHEN 'diferencia_efectivo' THEN (
          SELECT COALESCE(c.efectivo_contado, 0) - (
            c.efectivo_inicial
            + COALESCE((SELECT SUM(v.monto) FROM ventas v WHERE v.cierre_id = c.id AND v.medio_pago = 'efectivo'), 0)
            - COALESCE((SELECT SUM(g.monto) FROM gastos g WHERE g.cierre_id = c.id AND g.medio_pago = 'efectivo'), 0)
          ) FROM cierres c WHERE c.id = causas_candidatas.cierre_id
        ) ELSE 0 END
    `);
  }
  database.exec(`
    UPDATE cierres SET estado = CASE
      WHEN diferencia = 0 THEN 'conciliado'
      WHEN COALESCE((SELECT SUM(cc.efecto) FROM causas_candidatas cc WHERE cc.cierre_id = cierres.id AND cc.estado = 'confirmada'), 0) = diferencia THEN 'resuelto'
      ELSE 'con_diferencia' END
  `);
}

migrate();

export function all<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return database.prepare(sql).all(...params) as T[];
}

export function get<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return database.prepare(sql).get(...params) as T | undefined;
}

export function run(sql: string, ...params: SQLInputValue[]) {
  return database.prepare(sql).run(...params);
}

export function transaction<T>(callback: () => T): T {
  database.exec("BEGIN IMMEDIATE;");
  try {
    const result = callback();
    database.exec("COMMIT;");
    return result;
  } catch (error) {
    database.exec("ROLLBACK;");
    throw error;
  }
}

export { databasePath };
