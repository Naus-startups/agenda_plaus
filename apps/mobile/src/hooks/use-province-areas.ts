import { useEffect, useMemo, useState } from "react";
import type { BusinessDTO, MunicipalityDTO } from "@slotix/types";

import { listAllBusinesses } from "@/services/businesses";
import { listMunicipalities, municipalityOptions, type MunicipalityOption } from "@/services/localities";

type Loaded = { provincia: string; municipalities: MunicipalityDTO[] | null; spaces: BusinessDTO[] };

/**
 * Os municípios de uma província e os bairros de cada um, com quantos espaços ficam em
 * cada sítio — o que os ecrãs de escolha de localização mostram. `failed` diz que os
 * municípios não vieram (sem ligação): o ecrã avisa em vez de mostrar uma lista vazia.
 */
export function useProvinceAreas(provincia: string | null): {
  municipalities: MunicipalityOption[];
  loading: boolean;
  failed: boolean;
} {
  // A resposta fica com a província a que responde: ao mudar de província, a anterior
  // deixa de contar sem ser preciso limpá-la.
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!provincia) return;

    let cancelled = false;
    Promise.all([
      listMunicipalities(provincia).catch(() => null),
      listAllBusinesses({ provincia }).catch(() => [] as BusinessDTO[]),
    ]).then(([municipalities, spaces]) => {
      if (!cancelled) setLoaded({ provincia, municipalities, spaces });
    });

    return () => {
      cancelled = true;
    };
  }, [provincia]);

  const current = provincia && loaded?.provincia === provincia ? loaded : null;
  const municipalities = useMemo(
    () => (current?.municipalities ? municipalityOptions(current.municipalities, current.spaces) : []),
    [current],
  );
  return { municipalities, loading: Boolean(provincia) && !current, failed: current?.municipalities === null };
}
