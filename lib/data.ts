import { conciliarCierre, determinarEstadoCierre, type GastoConciliable, type MovimientoPagoConciliable, type VentaConciliable } from "./conciliacion.ts";
import { all, get, run, transaction, type DbExecutor } from "./db.ts";
import type {
  CausaCandidataVista,
  Cierre,
  CierreListado,
  EstadoCierre,
  MedioPago,
  MovimientoDia,
  ResumenCierre,
  TipoMovimiento,
} from "./types.ts";

interface EntidadConciliableRow { id: number; cierre_id: number; monto: number; medio_pago: MedioPago; hora: string }
interface CausaRow { id: number; tipo: CausaCandidataVista["tipo"]; referencia_tipo: CausaCandidataVista["referenciaTipo"]; referencia_id: number | null; monto: number; efecto: number; estado: CausaCandidataVista["estado"]; medio_pago: MedioPago | null; hora: string | null; explicacion_ia: string | null }

interface CierreRow {
  id: number;
  fecha: string;
  efectivo_inicial: number;
  efectivo_contado: number | null;
  total_esperado: number;
  total_registrado: number;
  diferencia: number;
  estado: EstadoCierre;
  finalizado_at: string | null;
  es_demo: number;
}

interface TotalesRow {
  ventas_efectivo: number;
  ventas_transferencia: number;
  ventas_mercado_pago: number;
  gastos_efectivo: number;
  gastos_transferencia: number;
  gastos_mercado_pago: number;
  pagos_transferencia: number;
  pagos_mercado_pago: number;
  cantidad_ventas: number;
  cantidad_gastos: number;
  cantidad_pagos: number;
}

interface MovimientoRow {
  id: number;
  tipo: "venta" | "gasto" | "pago";
  monto: number;
  medio_pago: MedioPago;
  hora: string;
  detalle: string;
  categoria: string | null;
  descripcion: string | null;
}

export const MENSAJE_EFECTIVO_INSUFICIENTE = "Este gasto supera el efectivo disponible en caja. Revisá el efectivo inicial, las ventas registradas o el monto del gasto.";

export class EfectivoInsuficienteError extends Error {
  readonly disponible: number;
  readonly gasto: number;

  constructor(disponible: number, gasto: number) {
    super(MENSAJE_EFECTIVO_INSUFICIENTE);
    this.name = "EfectivoInsuficienteError";
    this.disponible = disponible;
    this.gasto = gasto;
  }
}

export function calcularEfectivoDisponible(efectivoInicial: number, ventasEfectivo: number, gastosEfectivo: number): number {
  return efectivoInicial + ventasEfectivo - gastosEfectivo;
}

export async function obtenerEfectivoDisponible(cierreId: number, executor?: DbExecutor): Promise<number> {
  const row = await get<{ disponible: number }>(`SELECT efectivo_inicial
    + COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = cierres.id AND medio_pago = 'efectivo'), 0)
    - COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = cierres.id AND medio_pago = 'efectivo'), 0) AS disponible
    FROM cierres WHERE id = ?`, [cierreId], executor);
  if (!row) throw new Error("El cierre seleccionado no existe.");
  return row.disponible;
}

export async function validarGastoEfectivo(cierreId: number, monto: number, executor?: DbExecutor): Promise<void> {
  const disponible = await obtenerEfectivoDisponible(cierreId, executor);
  if (disponible - monto < 0) {
    throw new EfectivoInsuficienteError(disponible, monto);
  }
}

export function fechaLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function obtenerOCrearCierreActual(executor?: DbExecutor): Promise<CierreRow> {
  const fecha = fechaLocal();
  let cierre = await get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", [fecha], executor);
  if (!cierre) {
    await run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES (?, 0) ON CONFLICT(fecha) DO NOTHING", [fecha], executor);
    cierre = await get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", [fecha], executor);
  }
  if (!cierre) throw new Error("No se pudo crear el cierre del día actual.");
  return cierre;
}

export async function obtenerResumenCierreActual(): Promise<ResumenCierre> {
  const row = await obtenerOCrearCierreActual();

  return construirResumen(row);
}

export async function obtenerResumenCierrePorFecha(fecha: string): Promise<ResumenCierre | null> {
  const row = await get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", [fecha]);
  return row ? construirResumen(row) : null;
}

export async function obtenerCierresParaHistorico(): Promise<CierreListado[]> {
  return (await all<{ fecha: string; estado: EstadoCierre; finalizado_at: string | null }>("SELECT fecha, estado, finalizado_at FROM cierres ORDER BY fecha DESC")).map((row) => ({
    fecha: row.fecha, estado: row.estado, finalizadoAt: row.finalizado_at,
  }));
}

export async function obtenerCierresPendientes(fechaHoy = fechaLocal()): Promise<CierreListado[]> {
  return (await all<{ fecha: string; estado: EstadoCierre; finalizado_at: string | null }>(
    `SELECT c.fecha, c.estado, c.finalizado_at FROM cierres c
     WHERE c.fecha < ? AND c.finalizado_at IS NULL
       AND (c.efectivo_inicial > 0 OR COALESCE(c.efectivo_contado, 0) > 0
         OR EXISTS (SELECT 1 FROM ventas v WHERE v.cierre_id = c.id)
         OR EXISTS (SELECT 1 FROM gastos g WHERE g.cierre_id = c.id)
         OR EXISTS (SELECT 1 FROM movimientos_pago mp WHERE mp.cierre_id = c.id))
     ORDER BY c.fecha DESC`, [fechaHoy],
  )).map((row) => ({ fecha: row.fecha, estado: row.estado, finalizadoAt: row.finalizado_at }));
}

async function construirResumen(row: CierreRow): Promise<ResumenCierre> {

  const totales = await get<TotalesRow>(
    `
      SELECT
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'efectivo'), 0) AS ventas_efectivo,
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'transferencia'), 0) AS ventas_transferencia,
        COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND medio_pago = 'mercado_pago'), 0) AS ventas_mercado_pago,
        COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND medio_pago = 'efectivo'), 0) AS gastos_efectivo,
        COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND medio_pago = 'transferencia'), 0) AS gastos_transferencia,
        COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND medio_pago = 'mercado_pago'), 0) AS gastos_mercado_pago,
        COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago = 'transferencia'), 0) AS pagos_transferencia,
        COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago = 'mercado_pago'), 0) AS pagos_mercado_pago,
        (SELECT COUNT(*) FROM ventas WHERE cierre_id = ?) AS cantidad_ventas,
        (SELECT COUNT(*) FROM gastos WHERE cierre_id = ?) AS cantidad_gastos,
        (SELECT COUNT(*) FROM movimientos_pago WHERE cierre_id = ?) AS cantidad_pagos
    `,
    [row.id, row.id, row.id, row.id, row.id, row.id, row.id, row.id, row.id, row.id, row.id],
  );

  if (!totales) throw new Error("No se pudieron calcular los totales del cierre.");

  const cierre: Cierre = {
    id: row.id,
    fecha: row.fecha,
    efectivoInicial: row.efectivo_inicial,
    efectivoContado: row.efectivo_contado,
    totalEsperado: row.total_esperado,
    totalRegistrado: row.total_registrado,
    diferencia: row.diferencia,
    estado: row.estado,
    finalizadoAt: row.finalizado_at,
    esDemo: row.es_demo === 1,
  };

  const efectivoEsperado =
    cierre.efectivoInicial + totales.ventas_efectivo - totales.gastos_efectivo;
  const valores: Record<MedioPago, [number, number | null]> = {
    efectivo: [efectivoEsperado, cierre.efectivoContado],
    transferencia: [totales.ventas_transferencia - totales.gastos_transferencia, totales.pagos_transferencia],
    mercado_pago: [totales.ventas_mercado_pago - totales.gastos_mercado_pago, totales.pagos_mercado_pago],
  };

  return {
    cierre,
    desglose: (Object.entries(valores) as [MedioPago, [number, number | null]][]).map(
      ([medio, [esperado, registrado]]) => ({
        medio,
        esperado,
        registrado,
        diferencia: registrado == null ? null : registrado - esperado,
      }),
    ),
    cantidadVentas: totales.cantidad_ventas,
    cantidadGastos: totales.cantidad_gastos,
    cantidadMovimientosPago: totales.cantidad_pagos,
    tieneMovimientos:
      totales.cantidad_ventas + totales.cantidad_gastos + totales.cantidad_pagos > 0,
  };
}

export async function obtenerMovimientosDelDia(cierreId: number): Promise<MovimientoDia[]> {
  const rows = await all<MovimientoRow>(
    `SELECT id, 'venta' AS tipo, monto, medio_pago, hora, 'Venta' AS detalle, NULL AS categoria, NULL AS descripcion
       FROM ventas WHERE cierre_id = ?
     UNION ALL
     SELECT id, 'gasto', monto, medio_pago, hora, categoria AS detalle, categoria, NULLIF(descripcion, '')
       FROM gastos WHERE cierre_id = ?
     UNION ALL
     SELECT id, 'pago', monto, medio_pago, hora, 'Pago recibido', NULL, NULL
       FROM movimientos_pago WHERE cierre_id = ?
     ORDER BY hora DESC, id DESC`,
    [cierreId, cierreId, cierreId],
  );
  return rows.map((row) => ({
    id: row.id, tipo: row.tipo, monto: row.monto, medioPago: row.medio_pago,
    hora: row.hora, detalle: row.detalle, categoria: row.categoria, descripcion: row.descripcion,
  }));
}

function mapEntidad(row: EntidadConciliableRow): VentaConciliable {
  return { id: row.id, cierreId: row.cierre_id, monto: row.monto, medioPago: row.medio_pago, hora: row.hora };
}

export async function ejecutarConciliacion(cierreId: number): Promise<void> {
  const cierre = await get<CierreRow>("SELECT * FROM cierres WHERE id = ?", [cierreId]);
  if (!cierre) throw new Error("El cierre seleccionado no existe.");
  if (cierre.finalizado_at) throw new Error("El cierre está finalizado. Reabrilo para modificarlo.");
  const ventas = (await all<EntidadConciliableRow>("SELECT id, cierre_id, monto, medio_pago, hora FROM ventas WHERE cierre_id = ?", [cierre.id])).map(mapEntidad);
  const gastos = (await all<EntidadConciliableRow>("SELECT id, cierre_id, monto, medio_pago, hora FROM gastos WHERE cierre_id = ?", [cierre.id])).map(mapEntidad) as GastoConciliable[];
  const movimientosPago = (await all<EntidadConciliableRow>("SELECT id, cierre_id, monto, medio_pago, hora FROM movimientos_pago WHERE cierre_id = ?", [cierre.id])).map(mapEntidad) as MovimientoPagoConciliable[];
  const resultado = conciliarCierre({
    cierreId: cierre.id,
    efectivoInicial: cierre.efectivo_inicial,
    efectivoContado: cierre.efectivo_contado,
    ventas,
    gastos,
    movimientosPago,
  });

  await transaction(async (tx) => {
    await run("UPDATE ventas SET conciliada = 0 WHERE cierre_id = ?", [cierre.id], tx);
    await run("UPDATE movimientos_pago SET conciliado = 0 WHERE cierre_id = ?", [cierre.id], tx);
    for (const match of resultado.matches) {
      await run("UPDATE ventas SET conciliada = 1 WHERE id = ? AND cierre_id = ?", [match.venta.id, cierre.id], tx);
      await run("UPDATE movimientos_pago SET conciliado = 1 WHERE id = ? AND cierre_id = ?", [match.movimiento.id, cierre.id], tx);
    }

    await run("DELETE FROM causas_candidatas WHERE cierre_id = ? AND estado = 'pendiente'", [cierre.id], tx);
    if (cierre.efectivo_contado == null) {
      await run("DELETE FROM causas_candidatas WHERE cierre_id = ? AND tipo = 'diferencia_efectivo'", [cierre.id], tx);
    }
    for (const causa of resultado.causasCandidatas) {
      const existente = await get<{ id: number }>(
        `SELECT id FROM causas_candidatas WHERE cierre_id = ? AND tipo = ?
         AND referencia_tipo IS ? AND referencia_id IS ? AND monto = ? AND estado != 'pendiente'`,
        [cierre.id, causa.tipo, causa.referenciaTipo, causa.referenciaId, causa.monto], tx,
      );
      if (!existente) {
        await run(
          `INSERT INTO causas_candidatas
           (cierre_id, tipo, referencia_tipo, referencia_id, monto, efecto, tipo_match, estado)
           VALUES (?, ?, ?, ?, ?, ?, 'deterministico', 'pendiente')`,
          [cierre.id, causa.tipo, causa.referenciaTipo, causa.referenciaId, causa.monto, causa.efecto], tx,
        );
      } else {
        await run("UPDATE causas_candidatas SET efecto = ? WHERE id = ?", [causa.efecto, existente.id], tx);
      }
    }
    const efectos = (await all<{ efecto: number }>("SELECT efecto FROM causas_candidatas WHERE cierre_id = ? AND estado = 'confirmada'", [cierre.id], tx)).map((row) => row.efecto);
    const estado: EstadoCierre = determinarEstadoCierre(cierre.diferencia, efectos);
    await run("UPDATE cierres SET estado = ?, analizado = 1 WHERE id = ?", [estado, cierre.id], tx);
  });
}

export async function cierreFueAnalizado(cierreId: number): Promise<boolean> {
  return (await get<{ analizado: number }>("SELECT analizado FROM cierres WHERE id = ?", [cierreId]))?.analizado === 1;
}

export async function obtenerCausasCandidatas(cierreId: number, diferencia: number): Promise<CausaCandidataVista[]> {
  const rows = await all<CausaRow>(
    `SELECT c.id, c.tipo, c.referencia_tipo, c.referencia_id, c.monto, c.efecto, c.estado, c.explicacion_ia,
       COALESCE(v.medio_pago, mp.medio_pago) AS medio_pago,
       COALESCE(v.hora, mp.hora) AS hora
     FROM causas_candidatas c
     LEFT JOIN ventas v ON c.referencia_tipo = 'venta' AND v.id = c.referencia_id
     LEFT JOIN movimientos_pago mp ON c.referencia_tipo = 'movimiento_pago' AND mp.id = c.referencia_id
     WHERE c.cierre_id = ?
     ORDER BY CASE c.estado WHEN 'pendiente' THEN 0 WHEN 'confirmada' THEN 1 ELSE 2 END, c.id`,
    [cierreId],
  );
  const efectivo = await get<{ esperado: number; contado: number | null }>(
    `SELECT ci.efectivo_inicial
       + COALESCE((SELECT SUM(v.monto) FROM ventas v WHERE v.cierre_id = ci.id AND v.medio_pago = 'efectivo'), 0)
       - COALESCE((SELECT SUM(g.monto) FROM gastos g WHERE g.cierre_id = ci.id AND g.medio_pago = 'efectivo'), 0) AS esperado,
       ci.efectivo_contado AS contado FROM cierres ci WHERE ci.id = ?`,
    [cierreId],
  );
  const principalId = rows.find((row) => row.efecto === diferencia)?.id;
  return rows.map((row) => ({
    id: row.id, tipo: row.tipo, referenciaTipo: row.referencia_tipo, referenciaId: row.referencia_id,
    monto: row.monto, efecto: row.efecto, estado: row.estado, medioPago: row.medio_pago, hora: row.hora,
    esPrincipal: row.id === principalId, explicacionExacta: principalId !== undefined,
    efectivoEsperado: row.tipo === "diferencia_efectivo" ? efectivo?.esperado ?? null : null,
    efectivoContado: row.tipo === "diferencia_efectivo" ? efectivo?.contado ?? null : null,
    explicacionIa: row.explicacion_ia,
  }));
}

export async function guardarExplicacionCausa(causaId: number, explicacion: string): Promise<void> {
  await run(`UPDATE causas_candidatas SET explicacion_ia = ? WHERE id = ?
    AND EXISTS (SELECT 1 FROM cierres WHERE cierres.id = causas_candidatas.cierre_id AND cierres.finalizado_at IS NULL)`, [explicacion, causaId]);
}

export async function obtenerDiferenciaCierre(cierreId: number): Promise<number> {
  const cierre = await get<{ diferencia: number }>("SELECT diferencia FROM cierres WHERE id = ?", [cierreId]);
  if (!cierre) throw new Error("El cierre seleccionado no existe.");
  return cierre.diferencia;
}

export async function cambiarEstadoCausa(causaId: number, estado: "confirmada" | "descartada"): Promise<void> {
  const cierre = await get<CierreRow>(
    "SELECT cierres.* FROM cierres JOIN causas_candidatas ON causas_candidatas.cierre_id = cierres.id WHERE causas_candidatas.id = ?",
    [causaId],
  );
  if (!cierre) throw new Error("La causa seleccionada no existe.");
  if (cierre.finalizado_at) throw new Error("El cierre está finalizado. Reabrilo para modificarlo.");
  await transaction(async (tx) => {
    await run("UPDATE causas_candidatas SET estado = ? WHERE id = ? AND cierre_id = ?", [estado, causaId, cierre.id], tx);
    const efectos = (await all<{ efecto: number }>("SELECT efecto FROM causas_candidatas WHERE cierre_id = ? AND estado = 'confirmada'", [cierre.id], tx)).map((row) => row.efecto);
    const nuevoEstado: EstadoCierre = determinarEstadoCierre(cierre.diferencia, efectos);
    await run("UPDATE cierres SET estado = ? WHERE id = ?", [nuevoEstado, cierre.id], tx);
  });
}

export async function obtenerCierreEditable(cierreId: number, executor?: DbExecutor): Promise<CierreRow> {
  const cierre = await get<CierreRow>("SELECT * FROM cierres WHERE id = ?", [cierreId], executor);
  if (!cierre) throw new Error("El cierre seleccionado no existe.");
  if (cierre.finalizado_at) throw new Error("El cierre está finalizado. Reabrilo para modificarlo.");
  return cierre;
}

export async function obtenerCierreParaCargaReal(cierreId: number, executor?: DbExecutor): Promise<CierreRow> {
  const cierre = await obtenerCierreEditable(cierreId, executor);
  if (cierre.es_demo === 1) throw new Error("Primero elegí Empezar con mis datos para salir del escenario demo.");
  return cierre;
}

export async function eliminarMovimiento(cierreId: number, tipo: TipoMovimiento, movimientoId: number): Promise<void> {
  if (!Number.isSafeInteger(movimientoId) || movimientoId <= 0) throw new Error("El movimiento seleccionado no es válido.");
  const tablas: Record<TipoMovimiento, "ventas" | "gastos" | "movimientos_pago"> = {
    venta: "ventas",
    gasto: "gastos",
    pago: "movimientos_pago",
  };
  if (!(tipo in tablas)) throw new Error("El tipo de movimiento no es válido.");
  await transaction(async (tx) => {
    const cierre = await obtenerCierreEditable(cierreId, tx);
    const eliminado = await run(`DELETE FROM ${tablas[tipo]} WHERE id = ? AND cierre_id = ?`, [movimientoId, cierre.id], tx);
    if (eliminado.rowsAffected === 0) return;
    await run("DELETE FROM causas_candidatas WHERE cierre_id = ?", [cierre.id], tx);
    await run("UPDATE ventas SET conciliada = 0 WHERE cierre_id = ?", [cierre.id], tx);
    await run("UPDATE movimientos_pago SET conciliado = 0 WHERE cierre_id = ?", [cierre.id], tx);
    await run(`UPDATE cierres SET
      total_esperado = CASE WHEN efectivo_contado IS NULL THEN 0 ELSE efectivo_inicial END
        + COALESCE((SELECT SUM(monto) FROM ventas WHERE cierre_id = ? AND (medio_pago != 'efectivo' OR cierres.efectivo_contado IS NOT NULL)), 0)
        - COALESCE((SELECT SUM(monto) FROM gastos WHERE cierre_id = ? AND (medio_pago != 'efectivo' OR cierres.efectivo_contado IS NOT NULL)), 0),
      total_registrado = COALESCE(efectivo_contado, 0)
        + COALESCE((SELECT SUM(monto) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago != 'efectivo'), 0)
      WHERE id = ?`, [cierre.id, cierre.id, cierre.id, cierre.id], tx);
    await run("UPDATE cierres SET diferencia = total_registrado - total_esperado WHERE id = ?", [cierre.id], tx);
    await run("UPDATE cierres SET analizado = 0, estado = CASE WHEN diferencia = 0 THEN 'conciliado' ELSE 'con_diferencia' END WHERE id = ?", [cierre.id], tx);
  });
}

export async function finalizarCierre(cierreId: number): Promise<void> {
  const cierre = await obtenerCierreEditable(cierreId);
  await run("UPDATE cierres SET finalizado_at = CURRENT_TIMESTAMP WHERE id = ? AND finalizado_at IS NULL", [cierre.id]);
}

export async function reabrirCierre(cierreId: number): Promise<void> {
  const resultado = await run("UPDATE cierres SET finalizado_at = NULL WHERE id = ? AND finalizado_at IS NOT NULL", [cierreId]);
  if (resultado.rowsAffected === 0) {
    const existe = await get<{ id: number }>("SELECT id FROM cierres WHERE id = ?", [cierreId]);
    if (!existe) throw new Error("El cierre seleccionado no existe.");
  }
}

export const ESCENARIO_DEMO = {
  efectivoContado: 2_550_000,
  ventas: [
    { monto: 3_050_000, medio: "efectivo" as const, hora: "10:00" },
    { monto: 1_600_000, medio: "transferencia" as const, hora: "11:00" },
    { monto: 930_000, medio: "mercado_pago" as const, hora: "12:00" },
    { monto: 1_250_000, medio: "mercado_pago" as const, hora: "13:00" },
  ],
  gastos: [{ monto: 500_000, medio: "efectivo" as const, hora: "10:30", categoria: "Gasto del día" }],
  pagos: [
    { monto: 1_600_000, medio: "transferencia" as const, hora: "11:02" },
    { monto: 930_000, medio: "mercado_pago" as const, hora: "12:02" },
  ],
} as const;

async function cantidadDatosCierre(cierreId: number, executor?: DbExecutor): Promise<number> {
  return Number((await get<{ total: number }>(
    `SELECT (SELECT COUNT(*) FROM ventas WHERE cierre_id = ?)
      + (SELECT COUNT(*) FROM gastos WHERE cierre_id = ?)
      + (SELECT COUNT(*) FROM movimientos_pago WHERE cierre_id = ?) AS total`, [cierreId, cierreId, cierreId], executor))?.total ?? 0);
}

async function escribirEscenarioDemo(cierreId: number, tx: DbExecutor): Promise<void> {
    await run("DELETE FROM csv_importaciones WHERE cierre_id = ?", [cierreId], tx);
    await run("DELETE FROM causas_candidatas WHERE cierre_id = ?", [cierreId], tx);
    await run("DELETE FROM ventas WHERE cierre_id = ?", [cierreId], tx);
    await run("DELETE FROM gastos WHERE cierre_id = ?", [cierreId], tx);
    await run("DELETE FROM movimientos_pago WHERE cierre_id = ?", [cierreId], tx);
    await run("UPDATE cierres SET efectivo_inicial = 0, efectivo_contado = ?, total_esperado = 0, total_registrado = 0, diferencia = 0, estado = 'pendiente', analizado = 0, es_demo = 1 WHERE id = ?", [ESCENARIO_DEMO.efectivoContado, cierreId], tx);
    for (const venta of ESCENARIO_DEMO.ventas) {
      await run("INSERT INTO ventas (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, ?, ?, ?, 'formulario')", [cierreId, venta.monto, venta.medio, venta.hora], tx);
    }
    for (const gasto of ESCENARIO_DEMO.gastos) {
      await run("INSERT INTO gastos (cierre_id, monto, categoria, descripcion, medio_pago, hora, metodo_carga) VALUES (?, ?, ?, '', ?, ?, 'formulario')", [cierreId, gasto.monto, gasto.categoria, gasto.medio, gasto.hora], tx);
    }
    for (const pago of ESCENARIO_DEMO.pagos) {
      await run("INSERT INTO movimientos_pago (cierre_id, monto, medio_pago, hora, metodo_carga) VALUES (?, ?, ?, ?, 'formulario')", [cierreId, pago.monto, pago.medio, pago.hora], tx);
    }
    await run(`UPDATE cierres SET
      total_esperado = efectivo_inicial + (SELECT COALESCE(SUM(monto), 0) FROM ventas WHERE cierre_id = ?) - (SELECT COALESCE(SUM(monto), 0) FROM gastos WHERE cierre_id = ?),
      total_registrado = efectivo_contado + (SELECT COALESCE(SUM(monto), 0) FROM movimientos_pago WHERE cierre_id = ? AND medio_pago != 'efectivo')
      WHERE id = ?`, [cierreId, cierreId, cierreId, cierreId], tx);
    await run("UPDATE cierres SET diferencia = total_registrado - total_esperado, estado = 'con_diferencia' WHERE id = ?", [cierreId], tx);
}

export async function cargarDatosEscenarioDemo(cierreId: number): Promise<void> {
  await transaction(async (tx) => {
    const cierre = await obtenerCierreEditable(cierreId, tx);
    if (cierre.es_demo === 1) return;
    if (await cantidadDatosCierre(cierre.id, tx)) throw new Error("Este cierre ya contiene datos. Para cargar el escenario demo primero tenés que vaciarlo.");
    await escribirEscenarioDemo(cierre.id, tx);
  });
}

export async function restablecerDatosEscenarioDemo(cierreId: number): Promise<void> {
  await transaction(async (tx) => {
    const cierre = await obtenerCierreEditable(cierreId, tx);
    if (cierre.es_demo !== 1) throw new Error("Este cierre no está usando el escenario demo.");
    await escribirEscenarioDemo(cierre.id, tx);
  });
}

export async function vaciarDatosCierre(cierreId: number, soloSiDemo = false): Promise<string> {
  let fecha = "";
  await transaction(async (tx) => {
    const cierre = await obtenerCierreEditable(cierreId, tx);
    if (soloSiDemo && cierre.es_demo !== 1) throw new Error("Este cierre no está usando el escenario demo.");
    fecha = cierre.fecha;
    await run("DELETE FROM csv_importaciones WHERE cierre_id = ?", [cierre.id], tx);
    await run("DELETE FROM causas_candidatas WHERE cierre_id = ?", [cierre.id], tx);
    await run("DELETE FROM ventas WHERE cierre_id = ?", [cierre.id], tx);
    await run("DELETE FROM gastos WHERE cierre_id = ?", [cierre.id], tx);
    await run("DELETE FROM movimientos_pago WHERE cierre_id = ?", [cierre.id], tx);
    await run(`UPDATE cierres SET efectivo_contado = NULL, total_esperado = 0,
      total_registrado = 0, diferencia = 0, estado = 'conciliado',
      analizado = 0, es_demo = 0 WHERE id = ?`, [cierre.id], tx);
  });
  return fecha;
}
