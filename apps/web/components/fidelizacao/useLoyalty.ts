"use client";

import { useCallback, useEffect, useState } from "react";
import { loyaltyFetch } from "@/lib/loyalty-api";

// Carrega uma secção da fidelização e volta a carregar quando se pede (depois de guardar).
export function useLoyalty<T>(path: string) {
  const [state, setState] = useState<{ data: T | null; error: string }>({ data: null, error: "" });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loyaltyFetch<T>(path)
      .then((data) => !cancelled && setState({ data, error: "" }))
      .catch((error: Error) => !cancelled && setState((current) => ({ data: current.data, error: error.message })));
    return () => {
      cancelled = true;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { data: state.data, error: state.error, reload };
}
