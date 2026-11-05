import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { columnsToStars, skyApi, starsApi } from "@/api/endpoints";
import type { Constellation, Star } from "@/types/star";
import { BRIGHT_TIER_VMAG } from "@/types/filters";
import { TILE_DEC, TILE_RA } from "./tiles";

/**
 * Дані карти (UC-02, AD-06): спершу всі яскраві зорі (Vmag ≤ 6,5), потім — слабші
 * зорі лише для потрібних ділянок неба (тайли 30° × 30°), щойно їх запитує карта.
 */

interface CatalogValue {
  stars: Star[];
  byHip: Map<number, Star>;
  constellations: Constellation[];
  ready: boolean;
  error: string | null;
  /** Ділянки неба, для яких запит слабких зір завершився помилкою (EX1) */
  failedTiles: string[];
  loadingTiles: number;
  requestTiles: (ids: string[]) => void;
  retry: () => void;
}

const CatalogContext = createContext<CatalogValue | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [bright, setBright] = useState<Star[]>([]);
  const [faint, setFaint] = useState<Map<string, Star[]>>(new Map());
  const [constellations, setConstellations] = useState<Constellation[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedTiles, setFailed] = useState<string[]>([]);
  const [loadingTiles, setLoadingTiles] = useState(0);
  const inflight = useRef(new Set<string>());
  const loaded = useRef(new Set<string>());

  const loadBase = useCallback(async () => {
    setError(null);
    try {
      const [c, cons] = await Promise.all([starsApi.compact({ vmag_max: BRIGHT_TIER_VMAG }), skyApi.constellations()]);
      setBright(columnsToStars(c.columns));
      setConstellations(cons);
      setReady(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося завантажити дані каталогу");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- первинне завантаження каталогу
    void loadBase();
  }, [loadBase]);

  const fetchTile = useCallback(async (id: string) => {
    if (inflight.current.has(id) || loaded.current.has(id)) return;
    inflight.current.add(id);
    setLoadingTiles((n) => n + 1);
    const [i, j] = id.split(":").map(Number);
    try {
      const r = await starsApi.compact({
        vmag_min: BRIGHT_TIER_VMAG, vmag_max: 15,
        ra_min: i * TILE_RA, ra_max: i * TILE_RA + TILE_RA - 1e-9,
        dec_min: -90 + j * TILE_DEC, dec_max: j === 5 ? 90 : -90 + (j + 1) * TILE_DEC - 1e-9,
      });
      loaded.current.add(id);
      setFaint((m) => new Map(m).set(id, columnsToStars(r.columns)));
      setFailed((f) => f.filter((x) => x !== id));
    } catch {
      setFailed((f) => (f.includes(id) ? f : [...f, id]));
    } finally {
      inflight.current.delete(id);
      setLoadingTiles((n) => n - 1);
    }
  }, []);

  const requestTiles = useCallback((ids: string[]) => ids.forEach((id) => void fetchTile(id)), [fetchTile]);

  const retry = useCallback(() => {
    if (!ready) void loadBase();
    failedTiles.forEach((id) => void fetchTile(id));
  }, [ready, loadBase, failedTiles, fetchTile]);

  const stars = useMemo(() => {
    if (faint.size === 0) return bright;
    const all = bright.slice();
    for (const list of faint.values()) for (const s of list) all.push(s);
    return all;
  }, [bright, faint]);

  const byHip = useMemo(() => new Map(stars.map((s) => [s.hip, s])), [stars]);

  return (
    <CatalogContext.Provider
      value={{ stars, byHip, constellations, ready, error, failedTiles, loadingTiles, requestTiles, retry }}
    >
      {children}
    </CatalogContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog має використовуватись всередині CatalogProvider");
  return ctx;
}
