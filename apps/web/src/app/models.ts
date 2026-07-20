/**
 * Curated on-device models Voyalier suggests when helping a user set up Ollama.
 * These are *suggestions* — the `tag` prefills an editable field, so any other
 * model (including a custom one) still works. Kept small on purpose: a balanced
 * pick and a lighter pick, both modest downloads that run on a typical laptop.
 *
 * Tags map to Ollama's model library; `size` is the approximate download.
 */
export interface RecommendedModel {
  /** Stable id for keys and the download busy-state. */
  id: string;
  /** Human label, e.g. "Gemma · 12B". */
  label: string;
  /** The Ollama tag pulled by `ollama pull <tag>`; prefilled but user-editable. */
  tag: string;
  /** Approximate on-disk download size. */
  size: string;
  /** One line on what it's good for. */
  blurbKey: MessageKey;
}

export const RECOMMENDED_MODELS: readonly RecommendedModel[] = [
  {
    id: "gemma",
    label: "Gemma · 12B",
    tag: "gemma4:12b-it-qat",
    size: "~7 GB",
    blurbKey: "localai.model.gemma.blurb",
  },
  {
    id: "qwen",
    label: "Qwen · 8B",
    tag: "qwen3:8b",
    size: "~5 GB",
    blurbKey: "localai.model.qwen.blurb",
  },
];

/** The terminal command that downloads a model tag. */
export function pullCommand(tag: string): string {
  return `ollama pull ${tag.trim()}`;
}
import type { MessageKey } from "./i18n";
