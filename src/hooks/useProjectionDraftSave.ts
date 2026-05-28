"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useDebouncedAutosave } from "./useDebouncedAutosave";
import type { Id } from "../../convex/_generated/dataModel";

const MAX_RETRIES = 3;
const DEBOUNCE_MS = 1500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function useProjectionDraftSave<T>(
  state: T,
  clientId?: Id<"clients">
) {
  const upsert = useMutation(api.functions.projectionDrafts.mutations.upsertDraft);
  const [retry, setRetry] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  // Track clientId in a ref so the `save` closure always reads the latest value
  // (matches the latestValueRef pattern in useDebouncedAutosave). Without this,
  // changing the client mid-debounce would write to the previous client's slot.
  const clientIdRef = useRef(clientId);
  useEffect(() => { clientIdRef.current = clientId; }, [clientId]);

  // Track latest state for the beforeunload/pagehide flush.
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const save = useCallback(
    async (v: T) => {
      const cid = clientIdRef.current;
      let lastError: unknown = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await upsert({
            ...(cid ? { clientId: cid } : {}),
            state: v as never,
          });
          setRetry(0);
          setLastSavedAt(Date.now());
          return;
        } catch (e) {
          lastError = e;
          setRetry(attempt + 1);
          if (attempt < MAX_RETRIES - 1) {
            await sleep(2 ** attempt * 1000); // 1s, 2s, 4s
          }
        }
      }
      throw lastError;
    },
    [upsert] // intentionally NOT [upsert, clientId] — we use the ref instead
  );

  // Flush pending state on page close to prevent data loss.
  // Best-effort: fire the mutation immediately with the latest known state.
  // Won't await — but keepalive lets the request finish even as tab closes.
  useEffect(() => {
    const handler = () => {
      const cid = clientIdRef.current;
      upsert({
        ...(cid ? { clientId: cid } : {}),
        state: stateRef.current as never,
      }).catch(() => { /* nothing we can do at unload */ });
    };
    window.addEventListener("pagehide", handler);
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("pagehide", handler);
      window.removeEventListener("beforeunload", handler);
    };
  }, [upsert]);

  const { status } = useDebouncedAutosave(state, save, DEBOUNCE_MS);

  // Clear retry counter when status returns to idle.
  useEffect(() => {
    if (status === "idle") setRetry(0);
  }, [status]);

  return { status, retry, lastSavedAt };
}
