"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="grid min-h-screen place-items-center p-5"><section className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-bold text-slate-950">No pudimos completar la acción</h1><p className="mt-2 text-sm text-slate-600">Revisá los datos e intentá nuevamente. Tu cierre sigue disponible.</p><button type="button" onClick={reset} className="mt-5 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white">Volver a intentar</button></section></main>;
}
