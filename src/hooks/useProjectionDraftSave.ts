"use client";
import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useDebouncedAutosave } from "./useDebouncedAutosave";

const MAX_RETRIES = 3;
const DEBOUNCE_MS = 1500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function useProjectionDraftSave<T>(state: T) {
  const upsert = useMutation(api.functions.projectionDrafts.mutations.upsertDraft);
  const [retry, setRetry] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);

  const save = useCallback(
    async (v: T) => {
      let lastError: unknown = null;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          await upsert({ state: v as never });
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
    [upsert]
  );

  const { status } = useDebouncedAutosave(state, save, DEBOUNCE_MS);

  // Clear retry counter when status returns to idle.
  useEffect(() => {
    if (status === "idle") setRetry(0);
  }, [status]);

  return { status, retry, lastSavedAt };
}
