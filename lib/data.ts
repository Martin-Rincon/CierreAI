import { conciliarCierre, determinarEstadoCierre, type GastoConciliable, type MovimientoPagoConciliable, type VentaConciliable } from "@/lib/conciliacion";
import { all, get, run, transaction } from "@/lib/db";
import type {
  CausaCandidataVista,
  Cierre,
  EstadoCierre,
  MedioPago,
  MovimientoDia,
  ResumenCierre,
} from "@/lib/types";

interface EntidadConciliableRow { id: number; cierre_id: number; monto: number; medio_pago: MedioPago; hora: string }
interface CausaRow { id: number; tipo: CausaCandidataVista["tipo"]; referencia_tipo: CausaCandidataVista["referenciaTipo"]; referencia_id: number | null; monto: number; efecto: number; estado: CausaCandidataVista["estado"]; medio_pago: MedioPago | null; hora: string | null }

interface CierreRow {
  id: number;
  fecha: string;
  efectivo_inicial: number;
  efectivo_contado: number | null;
  total_esperado: number;
  total_registrado: number;
  diferencia: number;
  estado: EstadoCierre;
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
}

export function fechaLocal(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function obtenerOCrearCierreActual(): CierreRow {
  const fecha = fechaLocal();
  let cierre = get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", fecha);
  if (!cierre) {
    run("INSERT INTO cierres (fecha, efectivo_inicial) VALUES (?, 0)", fecha);
    cierre = get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", fecha);
  }
  if (!cierre) throw new Error("No se pudo crear el cierre del día actual.");
  return cierre;
}

export function obtenerResumenCierreActual(): ResumenCierre {
  const row = obtenerOCrearCierreActual();

  return construirResumen(row);
}

export function obtenerResumenCierrePorFecha(fecha: string): ResumenCierre | null {
  const row = get<CierreRow>("SELECT * FROM cierres WHERE fecha = ?", fecha);
  return row ? construirResumen(row) : null;
}

export function obtenerFechasDeCierres(): string[] {
  return all<{ fecha: string }>("SELECT fecha FROM cierres ORDER BY fecha DESC").map((row) => row.fecha);
}

function construirResumen(row: CierreRow): ResumenCierre {

  const totales = get<TotalesRow>(
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
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
    row.id,
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
  };

  const efectivoEsperado =
    cierre.efectivoInicial + totales.ventas_efectivo - totales.gastos_efectivo;
  const valores: Record<MedioPago, [number, number]> = {
    efectivo: [efectivoEsperado, cierre.efectivoContado ?? 0],
    transferencia: [totales.ventas_transferencia - totales.gastos_transferencia, totales.pagos_transferencia],
    mercado_pago: [totales.ventas_mercado_pago - totales.gastos_mercado_pago, totales.pagos_mercado_pago],
  };

  return {
    cierre,
    desglose: (Object.entries(valores) as [MedioPago, [number, number]][]).map(
      ([medio, [esperado, registrado]]) => ({
        medio,
        esperado,
        registrado,
        diferencia: registrado - esperado,
      }),
    ),
    cantidadVentas: totales.cantidad_ventas,
    cantidadGastos: totales.cantidad_gastos,
    cantidadMovimientosPago: totales.cantidad_pagos,
    tieneMovimientos:
      totales.cantidad_ventas + totales.cantidad_gastos + totales.cantidad_pagos > 0,
  };
}

export function obtenerMovimientosDelDia(cierreId: number): MovimientoDia[] {
  const rows = all<MovimientoRow>(
    `SELECT id, 'venta' AS tipo, monto, medio_pago, hora, 'Venta' AS detalle
       FROM ventas WHERE cierre_id = ?
     UNION ALL
     SELECT id, 'gasto', monto, medio_pago, hora,
       CASE WHEN descripcion = '' THEN categoria ELSE categoria || ' · ' || descripcion END
       FROM gastos WHERE cierre_id = ?
     UNION ALL
     SELECT id, 'pago', monto, medio_pago, hora, 'Pago recibido'
       FROM movimientos_pago WHERE cierre_id = ?
     ORDER BY hora DESC, id DESC`,
    cierreId, cierreId, cierreId,
  );
  return rows.map((row) => ({
    id: row.id, tipo: row.tipo, monto: row.monto, medioPago: row.medio_pago,
    hora: row.hora, detalle: row.detalle,
  }));
}

function mapEntidad(row: EntidadConciliableRow): VentaConciliable {
  return { id: row.id, cierreId: row.cierre_id, monto: row.monto, medioPago: row.medio_pago, hora: row.hora };
}

export function ejecutarConciliacion(cierreId: number): void {
  const cierre = get<CierreRow>("SELECT * FROM cierres WHERE id = ?", cierreId);
  if (!cierre) throw new Error("El cierre seleccionado no existe.");
  const ventas = all<EntidadConciliableRow>("SELECT id, cierre_id, monto, medio_pago, hora FROM ventas WHERE cierre_id = ?", cierre.id).map(mapEntidad);
  const gastos = all<EntidadConciliableRow>("SELECT id, cierre_id, monto, medio_pago, hora FROM gastos WHERE cierre_id = ?", cierre.id).map(mapEntidad) as GastoConciliable[];
  const movimientosPago = all<EntidadConciliableRow>("SELECT id, cierre_id, monto, medio_pago, hora FROM movimientos_pago WHERE cierre_id = ?", cierre.id).map(mapEntidad) as MovimientoPagoConciliable[];
  const resultado = conciliarCierre({
    cierreId: cierre.id,
    efectivoInicial: cierre.efectivo_inicial,
    efectivoContado: cierre.efectivo_contado,
    ventas,
    gastos,
    movimientosPago,
  });

  transaction(() => {
    run("UPDATE ventas SET conciliada = 0 WHERE cierre_id = ?", cierre.id);
    run("UPDATE movimientos_pago SET conciliado = 0 WHERE cierre_id = ?", cierre.id);
    for (const match of resultado.matches) {
      run("UPDATE ventas SET conciliada = 1 WHERE id = ? AND cierre_id = ?", match.venta.id, cierre.id);
      run("UPDATE movimientos_pago SET conciliado = 1 WHERE id = ? AND cierre_id = ?", match.movimiento.id, cierre.id);
    }

    run("DELETE FROM causas_candidatas WHERE cierre_id = ? AND estado = 'pendiente'", cierre.id);
    for (const causa of resultado.causasCandidatas) {
      const existente = get<{ id: number }>(
        `SELECT id FROM causas_candidatas WHERE cierre_id = ? AND tipo = ?
         AND referencia_tipo IS ? AND referencia_id IS ? AND monto = ? AND estado != 'pendiente'`,
        cierre.id, causa.tipo, causa.referenciaTipo, causa.referenciaId, causa.monto,
      );
      if (!existente) {
        run(
          `INSERT INTO causas_candidatas
           (cierre_id, tipo, referencia_tipo, referencia_id, monto, efecto, tipo_match, estado)
           VALUES (?, ?, ?, ?, ?, ?, 'deterministico', 'pendiente')`,
          cierre.id, causa.tipo, causa.referenciaTipo, causa.referenciaId, causa.monto, causa.efecto,
        );
      } else {
        run("UPDATE causas_candidatas SET efecto = ? WHERE id = ?", causa.efecto, existente.id);
      }
    }
    const efectos = all<{ efecto: number }>("SELECT efecto FROM causas_candidatas WHERE cierre_id = ? AND estado = 'confirmada'", cierre.id).map((row) => row.efecto);
    const estado: EstadoCierre = determinarEstadoCierre(cierre.diferencia, efectos);
    run("UPDATE cierres SET estado = ?, analizado = 1 WHERE id = ?", estado, cierre.id);
  });
}

export function cierreFueAnalizado(cierreId: number): boolean {
  return get<{ analizado: number }>("SELECT analizado FROM cierres WHERE id = ?", cierreId)?.analizado === 1;
}

export function obtenerCausasCandidatas(cierreId: number, diferencia: number): CausaCandidataVista[] {
  const rows = all<CausaRow>(
    `SELECT c.id, c.tipo, c.referencia_tipo, c.referencia_id, c.monto, c.efecto, c.estado,
       COALESCE(v.medio_pago, mp.medio_pago) AS medio_pago,
       COALESCE(v.hora, mp.hora) AS hora
     FROM causas_candidatas c
     LEFT JOIN ventas v ON c.referencia_tipo = 'venta' AND v.id = c.referencia_id
     LEFT JOIN movimientos_pago mp ON c.referencia_tipo = 'movimiento_pago' AND mp.id = c.referencia_id
     WHERE c.cierre_id = ?
     ORDER BY CASE c.estado WHEN 'pendiente' THEN 0 WHEN 'confirmada' THEN 1 ELSE 2 END, c.id`,
    cierreId,
  );
  const objetivo = Math.abs(diferencia);
  const efectivo = get<{ esperado: number; contado: number | null }>(
    `SELECT ci.efectivo_inicial
       + COALESCE((SELECT SUM(v.monto) FROM ventas v WHERE v.cierre_id = ci.id AND v.medio_pago = 'efectivo'), 0)
       - COALESCE((SELECT SUM(g.monto) FROM gastos g WHERE g.cierre_id = ci.id AND g.medio_pago = 'efectivo'), 0) AS esperado,
       ci.efectivo_contado AS contado FROM cierres ci WHERE ci.id = ?`,
    cierreId,
  );
  const principalId = rows.find((row) => row.monto === objetivo)?.id ?? rows[0]?.id;
  return rows.map((row) => ({
    id: row.id, tipo: row.tipo, referenciaTipo: row.referencia_tipo, referenciaId: row.referencia_id,
    monto: row.monto, efecto: row.efecto, estado: row.estado, medioPago: row.medio_pago, hora: row.hora,
    esPrincipal: row.id === principalId, explicacionExacta: rows.some((item) => item.monto === objetivo),
    efectivoEsperado: row.tipo === "diferencia_efectivo" ? efectivo?.esperado ?? null : null,
    efectivoContado: row.tipo === "diferencia_efectivo" ? efectivo?.contado ?? null : null,
  }));
}

export function cambiarEstadoCausa(causaId: number, estado: "confirmada" | "descartada"): void {
  const cierre = get<CierreRow>(
    "SELECT cierres.* FROM cierres JOIN causas_candidatas ON causas_candidatas.cierre_id = cierres.id WHERE causas_candidatas.id = ?",
    causaId,
  );
  if (!cierre) throw new Error("La causa seleccionada no existe.");
  transaction(() => {
    run("UPDATE causas_candidatas SET estado = ? WHERE id = ? AND cierre_id = ?", estado, causaId, cierre.id);
    const efectos = all<{ efecto: number }>("SELECT efecto FROM causas_candidatas WHERE cierre_id = ? AND estado = 'confirmada'", cierre.id).map((row) => row.efecto);
    const nuevoEstado: EstadoCierre = determinarEstadoCierre(cierre.diferencia, efectos);
    run("UPDATE cierres SET estado = ? WHERE id = ?", nuevoEstado, cierre.id);
  });
}
