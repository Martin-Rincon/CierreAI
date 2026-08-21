import { createHash } from "node:crypto";
import type { MedioPago, TipoMovimiento } from "./types.ts";

export const CSV_MAX_BYTES = 1024 * 1024;
export const CSV_MAX_ROWS = 1000;
export const CSV_HEADERS = ["tipo", "monto", "medio_pago", "hora", "categoria", "descripcion"] as const;

export interface MovimientoCsv {
  tipo: TipoMovimiento;
  montoCentavos: number;
  medioPago: MedioPago;
  hora: string;
  categoria: string;
  descripcion: string;
  fila: number;
}

export interface CsvValidado {
  movimientos: MovimientoCsv[];
  fingerprint: string;
  resumen: { ventas: number; gastos: number; pagos: number };
}

export class CsvValidationError extends Error {
  readonly errores: string[];

  constructor(errores: string[]) {
    super(errores.join("\n"));
    this.name = "CsvValidationError";
    this.errores = errores;
  }
}

function parsearRegistros(contenido: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let entreComillas = false;

  for (let i = 0; i < contenido.length; i += 1) {
    const caracter = contenido[i];
    if (entreComillas) {
      if (caracter === '"') {
        if (contenido[i + 1] === '"') { campo += '"'; i += 1; }
        else entreComillas = false;
      } else campo += caracter;
    } else if (caracter === '"' && campo.length === 0) entreComillas = true;
    else if (caracter === ",") { fila.push(campo); campo = ""; }
    else if (caracter === "\n" || caracter === "\r") {
      if (caracter === "\r" && contenido[i + 1] === "\n") i += 1;
      fila.push(campo); filas.push(fila); fila = []; campo = "";
    } else campo += caracter;
  }
  if (entreComillas) throw new CsvValidationError(["El CSV contiene un campo entre comillas sin cerrar."]);
  if (campo.length > 0 || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas.filter((campos) => campos.some((valor) => valor.trim() !== ""));
}

function normalizarTipo(valor: string): TipoMovimiento | null {
  const tipo = valor.trim().toLocaleLowerCase("es-AR");
  return tipo === "venta" || tipo === "gasto" || tipo === "pago" ? tipo : null;
}

function normalizarMedio(valor: string): MedioPago | null {
  const medio = valor.trim().toLocaleLowerCase("es-AR").replace(/[ _-]+/g, " ");
  if (medio === "efectivo") return "efectivo";
  if (medio === "transferencia" || medio === "transfer") return "transferencia";
  if (medio === "mercado pago" || medio === "mp") return "mercado_pago";
  return null;
}

export function pesosACentavos(valor: string): number | null {
  const monto = valor.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(monto)) return null;
  const [pesos, decimales = ""] = monto.replace(",", ".").split(".");
  const centavos = BigInt(pesos) * 100n + BigInt(decimales.padEnd(2, "0"));
  if (centavos <= 0n || centavos > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(centavos);
}

export function validarCsv(contenidoOriginal: string, bytes = Buffer.byteLength(contenidoOriginal, "utf8")): CsvValidado {
  const bytesReales = Buffer.byteLength(contenidoOriginal, "utf8");
  if (Math.max(bytes, bytesReales) > CSV_MAX_BYTES) throw new CsvValidationError(["El archivo supera el límite de 1 MB."]);
  const contenido = contenidoOriginal.startsWith("\uFEFF") ? contenidoOriginal.slice(1) : contenidoOriginal;
  const filas = parsearRegistros(contenido);
  if (filas.length === 0) throw new CsvValidationError(["El CSV está vacío."]);
  const encabezados = filas[0].map((valor) => valor.trim().toLocaleLowerCase("es-AR"));
  if (encabezados.length !== CSV_HEADERS.length || !CSV_HEADERS.every((valor, i) => encabezados[i] === valor)) {
    throw new CsvValidationError([`Los encabezados deben ser exactamente: ${CSV_HEADERS.join(",")}.`]);
  }
  if (filas.length === 1) throw new CsvValidationError(["El CSV no contiene movimientos."]);
  if (filas.length - 1 > CSV_MAX_ROWS) throw new CsvValidationError([`El CSV supera el límite de ${CSV_MAX_ROWS} filas.`]);

  const errores: string[] = [];
  const movimientos: MovimientoCsv[] = [];
  filas.slice(1).forEach((campos, indice) => {
    const numeroFila = indice + 2;
    if (campos.length !== CSV_HEADERS.length) {
      errores.push(`Fila ${numeroFila}: se esperaban ${CSV_HEADERS.length} columnas y se encontraron ${campos.length}.`);
      return;
    }
    const [tipoCrudo, montoCrudo, medioCrudo, horaCruda, categoriaCruda, descripcionCruda] = campos;
    const tipo = normalizarTipo(tipoCrudo);
    const montoCentavos = pesosACentavos(montoCrudo);
    const medioPago = normalizarMedio(medioCrudo);
    const hora = horaCruda.trim();
    const categoria = categoriaCruda.trim();
    const descripcion = descripcionCruda.trim();
    if (!tipo) errores.push(`Fila ${numeroFila}: tipo desconocido '${tipoCrudo.trim()}'.`);
    if (montoCentavos === null) errores.push(`Fila ${numeroFila}: monto inválido.`);
    if (!medioCrudo.trim()) errores.push(`Fila ${numeroFila}: medio de pago obligatorio.`);
    else if (!medioPago) errores.push(`Fila ${numeroFila}: medio de pago inválido '${medioCrudo.trim()}'.`);
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora)) errores.push(`Fila ${numeroFila}: hora inválida. Usá HH:mm.`);
    if (tipo === "gasto" && !categoria) errores.push(`Fila ${numeroFila}: los gastos requieren categoría.`);
    if (tipo && montoCentavos !== null && medioPago && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(hora) && (tipo !== "gasto" || categoria)) {
      movimientos.push({ tipo, montoCentavos, medioPago, hora, categoria, descripcion, fila: numeroFila });
    }
  });
  if (errores.length) throw new CsvValidationError(errores);
  const normalizado = movimientos.map((movimiento) => ({
    tipo: movimiento.tipo,
    montoCentavos: movimiento.montoCentavos,
    medioPago: movimiento.medioPago,
    hora: movimiento.hora,
    categoria: movimiento.categoria,
    descripcion: movimiento.descripcion,
  }));
  const fingerprint = createHash("sha256").update(JSON.stringify(normalizado), "utf8").digest("hex");
  return {
    movimientos,
    fingerprint,
    resumen: {
      ventas: movimientos.filter((item) => item.tipo === "venta").length,
      gastos: movimientos.filter((item) => item.tipo === "gasto").length,
      pagos: movimientos.filter((item) => item.tipo === "pago").length,
    },
  };
}
