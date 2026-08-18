"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ idle, pending, className }: { idle: string; pending: string; className: string }) {
  const { pending: isPending } = useFormStatus();
  return (
    <button type="submit" disabled={isPending} aria-disabled={isPending} className={`${className} disabled:cursor-wait disabled:opacity-60`}>
      {isPending ? pending : idle}
    </button>
  );
}
