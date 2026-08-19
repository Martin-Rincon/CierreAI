import assert from "node:assert/strict";
import { construirHechosParaIa, explicarCausa, explicacionDeterministica, horaActual, iaConfigurada, interpretarMovimiento, validarMovimientoInterpretado, validarRespuestaInterpretacion, type HechosExplicacionInternos } from "../lib/ia.ts";
import { conciliarCierre } from "../lib/conciliacion.ts";

const ahora = new Date(2026, 7, 19, 9, 7);

const venta = validarMovimientoInterpretado({ tipo: "venta", monto_centavos: 1_250_000, medio_pago: "mercado_pago", hora: "18:30" }, ahora);
assert.deepEqual(venta, { tipo: "venta", monto_centavos: 1_250_000, medio_pago: "mercado_pago", hora: "18:30" });

const gasto = validarMovimientoInterpretado({ tipo: "gasto", monto_centavos: 500_000, categoria: "Flete", descripcion: "Reparto", medio_pago: "efectivo", hora: "14:00" }, ahora);
assert.equal(gasto.tipo, "gasto");
assert.equal(gasto.categoria, "Flete");

const pago = validarMovimientoInterpretado({ tipo: "pago_recibido", monto_centavos: 1_600_000, medio_pago: "transferencia", hora: null }, ahora);
assert.equal(pago.hora, "09:07");
assert.equal(horaActual(ahora), "09:07");

assert.throws(() => validarMovimientoInterpretado({ tipo: "venta", monto_centavos: 100, medio_pago: "tarjeta", hora: "10:00" }));
assert.throws(() => validarMovimientoInterpretado({ tipo: "venta", monto_centavos: 0, medio_pago: "efectivo", hora: "10:00" }));
assert.throws(() => validarMovimientoInterpretado({ tipo: "venta", monto_centavos: 100, medio_pago: "efectivo", hora: "25:90" }));
assert.throws(() => validarMovimientoInterpretado({ interpretado: false, motivo: "Ambiguo" }));

const respuestaPlana = validarRespuestaInterpretacion({ interpretado: true, tipo: "venta", monto_centavos: 1_250_000, medio_pago: "mercado_pago", hora: "18:30", categoria: null, descripcion: null, motivo: null });
assert.equal(respuestaPlana.interpretado, true);
if (respuestaPlana.interpretado) assert.deepEqual(respuestaPlana.movimiento, venta);
assert.deepEqual(validarRespuestaInterpretacion({ interpretado: false, tipo: null, monto_centavos: null, medio_pago: null, hora: null, categoria: null, descripcion: null, motivo: "Falta el tipo de operación." }), { interpretado: false, motivo: "Falta el tipo de operación." });
assert.throws(() => validarRespuestaInterpretacion({ interpretado: true, tipo: "gasto", monto_centavos: 500_000, medio_pago: "efectivo", hora: "14:00", categoria: null, descripcion: null, motivo: null }));

const claveAnterior = process.env.GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;
assert.equal(iaConfigurada(), false);
const sinClave = await interpretarMovimiento("Vendí $100 en efectivo", ahora);
assert.equal(sinClave.ok, false);
const hechos: HechosExplicacionInternos = { diferenciaGeneralCentavos: -2_150_000, tipo: "venta_sin_pago", entidad: "venta #1", montoCentavos: 1_250_000, medio: "mercado_pago", hora: "18:30", efectoCentavos: -1_250_000, criterioMatch: "mismo monto y medio", resultadoAlgoritmo: "sin pago compatible" };
assert.equal(await explicarCausa(hechos), explicacionDeterministica(hechos));

const hechosVentaParaIa = construirHechosParaIa(hechos);
assert.equal(hechosVentaParaIa.monto_pesos, 12_500);
assert.equal(hechosVentaParaIa.monto_formateado, "$12.500");
assert.notEqual(hechosVentaParaIa.monto_formateado, "$1.250.000");
assert.equal(hechosVentaParaIa.diferencia_pesos, -21_500);
assert.equal(hechosVentaParaIa.diferencia_formateada, "-$21.500");

const hechosPagoParaIa = construirHechosParaIa({ ...hechos, tipo: "pago_sin_venta", montoCentavos: 500_000, efectoCentavos: 500_000 });
assert.equal(hechosPagoParaIa.efecto_pesos, 5_000);
assert.equal(hechosPagoParaIa.efecto_formateado, "+$5.000");

const hechosEfectivoParaIa = construirHechosParaIa({ ...hechos, tipo: "diferencia_efectivo", entidad: "efectivo del cierre" });
assert.equal(hechosEfectivoParaIa.monto_formateado, "$12.500");
assert.equal(hechosEfectivoParaIa.diferencia_formateada, "-$21.500");

process.env.GEMINI_API_KEY = "clave-falsa-para-test";
const generadorFallido = (async () => { throw new Error("fallo simulado"); }) as never;
const fallo = await interpretarMovimiento("Vendí $100 en efectivo", ahora, generadorFallido);
assert.equal(fallo.ok, false);
assert.equal(await explicarCausa(hechos, generadorFallido), explicacionDeterministica(hechos));

const copiaHechos = structuredClone(hechos);
const entradaConciliacion = { cierreId: 1, efectivoInicial: 0, efectivoContado: 0, ventas: [{ id: 1, cierreId: 1, monto: 1_250_000, medioPago: "mercado_pago" as const, hora: "18:30" }], gastos: [], movimientosPago: [] };
const conciliacionAntes = conciliarCierre(entradaConciliacion);
const promptsExplicacion: string[] = [];
const generadorExplicacion = (async (opciones: { prompt: string }) => {
  promptsExplicacion.push(opciones.prompt);
  return {
    text: "Demora de acreditación, error del banco, cobro pendiente o fraude.",
    output: { incluir_efecto: true, incluir_diferencia_general: true },
  };
}) as never;
const explicacionVenta = await explicarCausa(hechos, generadorExplicacion);
assert.match(explicacionVenta, /\$12\.500/);
assert.match(explicacionVenta, /-\$21\.500/);
assert.match(explicacionVenta, /no se encontr[oó] un pago compatible/i);
assert.doesNotMatch(explicacionVenta, /demora|acreditaci[oó]n|banco|olvido|pendiente|fraude/i);
assert.doesNotMatch(promptsExplicacion[0], /1250000|2150000/, "El prompt no debe contener centavos internos.");
const explicacionPago = await explicarCausa({ ...hechos, tipo: "pago_sin_venta", montoCentavos: 500_000, efectoCentavos: 500_000 }, generadorExplicacion);
assert.match(explicacionPago, /\+\$5\.000/);
assert.match(explicacionPago, /no se encontr[oó] una venta compatible/i);
assert.doesNotMatch(explicacionPago, /demora|acreditaci[oó]n|banco|Mercado Pago.*error|olvido|pendiente|fraude/i);
const explicacionEfectivo = await explicarCausa({ ...hechos, tipo: "diferencia_efectivo", entidad: "efectivo del cierre" }, generadorExplicacion);
assert.match(explicacionEfectivo, /-\$21\.500/);
assert.match(explicacionEfectivo, /efectivo contado no coincide con el efectivo esperado/i);
assert.doesNotMatch(explicacionEfectivo, /demora|acreditaci[oó]n|banco|olvido|pendiente|fraude/i);
assert.deepEqual(hechos, copiaHechos, "La explicación no debe alterar los hechos determinísticos.");
assert.deepEqual(conciliarCierre(entradaConciliacion), conciliacionAntes, "La explicación IA no debe alterar la conciliación, causa, monto ni efecto.");

if (claveAnterior === undefined) delete process.env.GEMINI_API_KEY;
else process.env.GEMINI_API_KEY = claveAnterior;

console.log("OK: validación, ambigüedad, fallbacks y aislamiento de hechos de IA.");
