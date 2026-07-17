import { useCallback } from "react";

import { useGateway } from "./context";
import type { ComboboxItem } from "../components/Combobox";

/**
 * A Combobox `fetchSuggestions` for place fields (origin/destination). It asks
 * the gateway's `suggestPlaces`, which matches — all locally, no network
 * geocoding — the bundled offline gazetteer (the world's cities), the pack
 * catalog, and the user's own trip history. The gateway ranks and dedupes; this
 * hook only maps the result to combobox items and stays out of the way on
 * error so free text always works.
 */
export function usePlaceSuggestions(): (
  query: string,
) => Promise<ComboboxItem[]> {
  const gateway = useGateway();

  return useCallback(
    async (query: string): Promise<ComboboxItem[]> => {
      try {
        const suggestions = await gateway.suggestPlaces(query);
        return suggestions.map((suggestion) => ({
          value: suggestion.value,
          detail: suggestion.detail,
        }));
      } catch {
        return [];
      }
    },
    [gateway],
  );
}
