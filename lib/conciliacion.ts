import type { MedioPago } from "./types";

export interface VentaConciliable {
  id: number;
  cierreId: number;
  monto: number;
  medioPago: MedioPago;
  hora: string;
}

export type MovimientoPagoConciliable = VentaConciliable;

export interface GastoConciliable {
  id: number;
  cierreId: number;
  monto: number;
  medioPago: MedioPago;
  hora: string;
}

export type TipoCausa = "venta_sin_pago" | "pago_sin_venta" | "diferencia_efectivo";

export interface CausaCalculada {
  tipo: TipoCausa;
  referenciaTipo: "venta" | "movimiento_pago" | null;
  referenciaId: number | null;
  monto: number;
  efecto: number;
}

export interface MatchDigital {
  venta: VentaConciliable;
  movimiento: MovimientoPagoConciliable;
  distanciaMinutos: number;
  candidatosCompatibles: number;
}

export interface ResultadoConciliacion {
  matches: MatchDigital[];
  ventasSinMatch: VentaConciliable[];
  movimientosSinMatch: MovimientoPagoConciliable[];
  efectivoEsperado: number;
  diferenciaEfectivo: number;
  causasCandidatas: CausaCalculada[];
}

export interface EntradaConciliacion {
  cierreId: number;
  efectivoInicial: number;
  efectivoContado: number | null;
  ventas: VentaConciliable[];
  gastos: GastoConciliable[];
  movimientosPago: MovimientoPagoConciliable[];
}

const DIGITALES: MedioPago[] = ["transferencia", "mercado_pago"];

function minutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

function porHoraEId<T extends { hora: string; id: number }>(a: T, b: T): number {
  return a.hora.localeCompare(b.hora) || a.id - b.id;
}

export function conciliarCierre(entrada: EntradaConciliacion): ResultadoConciliacion {
  const ventasDigitales = entrada.ventas
    .filter((v) => v.cierreId === entrada.cierreId && DIGITALES.includes(v.medioPago))
    .slice()
    .sort(porHoraEId);
  const movimientosDigitales = entrada.movimientosPago
    .filter((m) => m.cierreId === entrada.cierreId && DIGITALES.includes(m.medioPago))
    .slice()
    .sort(porHoraEId);
  const usados = new Set<number>();
  const matches: MatchDigital[] = [];
  const ventasSinMatch: VentaConciliable[] = [];

  for (const venta of ventasDigitales) {
    const candidatos = movimientosDigitales
      .filter((m) => !usados.has(m.id) && m.medioPago === venta.medioPago && m.monto === venta.monto)
      .sort((a, b) => {
        const distanciaA = Math.abs(minutos(a.hora) - minutos(venta.hora));
        const distanciaB = Math.abs(minutos(b.hora) - minutos(venta.hora));
        return distanciaA - distanciaB || porHoraEId(a, b);
      });
    const movimiento = candidatos[0];
    if (!movimiento) {
      ventasSinMatch.push(venta);
      continue;
    }
    usados.add(movimiento.id);
    matches.push({
      venta,
      movimiento,
      distanciaMinutos: Math.abs(minutos(movimiento.hora) - minutos(venta.hora)),
      candidatosCompatibles: candidatos.length,
    });
  }

  const movimientosSinMatch = movimientosDigitales.filter((m) => !usados.has(m.id));
  const ventasEfectivo = entrada.ventas
    .filter((v) => v.cierreId === entrada.cierreId && v.medioPago === "efectivo")
    .reduce((total, v) => total + v.monto, 0);
  const gastosEfectivo = entrada.gastos
    .filter((g) => g.cierreId === entrada.cierreId && g.medioPago === "efectivo")
    .reduce((total, g) => total + g.monto, 0);
  const efectivoEsperado = entrada.efectivoInicial + ventasEfectivo - gastosEfectivo;
  const diferenciaEfectivo = (entrada.efectivoContado ?? 0) - efectivoEsperado;

  const causasCandidatas: CausaCalculada[] = [
    ...ventasSinMatch.map((v): CausaCalculada => ({ tipo: "venta_sin_pago", referenciaTipo: "venta", referenciaId: v.id, monto: v.monto, efecto: -v.monto })),
    ...movimientosSinMatch.map((m): CausaCalculada => ({ tipo: "pago_sin_venta", referenciaTipo: "movimiento_pago", referenciaId: m.id, monto: m.monto, efecto: m.monto })),
  ];
  if (diferenciaEfectivo !== 0) {
    causasCandidatas.push({ tipo: "diferencia_efectivo", referenciaTipo: null, referenciaId: null, monto: Math.abs(diferenciaEfectivo), efecto: diferenciaEfectivo });
  }

  return { matches, ventasSinMatch, movimientosSinMatch, efectivoEsperado, diferenciaEfectivo, causasCandidatas };
}

export function determinarEstadoCierre(diferenciaGeneral: number, efectosConfirmados: number[]): "conciliado" | "con_diferencia" | "resuelto" {
  if (diferenciaGeneral === 0) return "conciliado";
  return efectosConfirmados.reduce((total, efecto) => total + efecto, 0) === diferenciaGeneral ? "resuelto" : "con_diferencia";
}
