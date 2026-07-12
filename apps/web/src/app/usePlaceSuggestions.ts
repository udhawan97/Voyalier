import { useCallback, useRef } from "react";
import type { PackInfo } from "@voyalier/contracts";

import { useGateway } from "./context";
import type { ComboboxItem } from "../components/Combobox";

/**
 * A Combobox `fetchSuggestions` for place fields (origin/destination), drawn from
 * local data only: the offline pack catalog plus the origins/destinations of the
 * user's existing trips. The source is loaded lazily on first use and cached for
 * the component's lifetime — no per-keystroke network geocoding.
 */
export function usePlaceSuggestions(): (
  query: string,
) => Promise<ComboboxItem[]> {
  const gateway = useGateway();
  const sourceRef = useRef<string[] | null>(null);
  // Share one in-flight load across rapid concurrent calls (focus + first
  // keystroke) so the source isn't fetched twice before the cache fills.
  const pendingRef = useRef<Promise<string[]> | null>(null);

  const loadSource = useCallback((): Promise<string[]> => {
    if (sourceRef.current) return Promise.resolve(sourceRef.current);
    if (pendingRef.current) return pendingRef.current;
    const load = (async (): Promise<string[]> => {
      const [packs, trips] = await Promise.all([
        gateway.listPacks().catch(() => [] as PackInfo[]),
        gateway.listTrips().catch(() => []),
      ]);
      const seen = new Set<string>();
      const values: string[] = [];
      const add = (raw: string) => {
        const trimmed = raw.trim();
        const key = trimmed.toLowerCase();
        if (trimmed && !seen.has(key)) {
          seen.add(key);
          values.push(trimmed);
        }
      };
      for (const pack of packs) add(pack.name);
      for (const trip of trips) {
        add(trip.origin);
        add(trip.destination);
      }
      sourceRef.current = values;
      pendingRef.current = null;
      return values;
    })();
    pendingRef.current = load;
    return load;
  }, [gateway]);

  return useCallback(
    async (query: string): Promise<ComboboxItem[]> => {
      const source = await loadSource();
      const needle = query.trim().toLowerCase();
      const prefix: ComboboxItem[] = [];
      const contains: ComboboxItem[] = [];
      for (const value of source) {
        const folded = value.toLowerCase();
        if (!needle || folded.startsWith(needle)) prefix.push({ value });
        else if (folded.includes(needle)) contains.push({ value });
      }
      return [...prefix, ...contains].slice(0, 8);
    },
    [loadSource],
  );
}
