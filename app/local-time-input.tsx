"use client";

import { useState } from "react";
import { horaLocalActual } from "@/lib/hora-local";

export function LocalTimeInput() {
  const [hora, setHora] = useState(() => typeof window === "undefined" ? "" : horaLocalActual());

  return <input suppressHydrationWarning type="time" name="hora" required value={hora} onChange={(event) => setHora(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm" />;
}
