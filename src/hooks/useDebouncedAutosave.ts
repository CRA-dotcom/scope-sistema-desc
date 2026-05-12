// src/hooks/useDebouncedAutosave.ts
import { useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export function useDebouncedAutosave<T>(
  value: T,
  save: (v: T) => Promise<void>,
  debounceMs = 2000
) {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const isFirstRenderRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestValueRef = useRef(value);

  useEffect(() => {
    latestValueRef.current = value;
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return; // no-op on first render, regardless of value identity
    }
    setStatus("pending");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setStatus("saving");
      try {
        await save(latestValueRef.current);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // `save` is intentionally omitted from deps to avoid re-arming the timer when
    // the parent passes a fresh closure on every render. Callers should memoize
    // `save` with useCallback if the function reads from state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, debounceMs]);

  return { status };
}
