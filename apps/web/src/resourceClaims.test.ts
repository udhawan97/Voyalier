import { readFileSync } from "node:fs";

const currentClaimFiles = [
  "../../../CONTEXT.md",
  "../../../docs/roadmap/ROADMAP.md",
  "../../../docs-site/src/content/docs/getting-started.mdx",
  "../../../docs-site/src/content/docs/privacy.mdx",
  "../../../docs-site/src/content/docs/guides/research-resources.mdx",
] as const;

describe("research-resource public claims", () => {
  it.each(currentClaimFiles)(
    "%s does not promise file-resource capture",
    (relativePath) => {
      const source = readFileSync(
        new URL(relativePath, import.meta.url),
        "utf8",
      );
      expect(source).not.toMatch(/links? (?:or|and) files?/i);
      expect(source).not.toMatch(/(?:drop|dropped|dropping) (?:in )?a file/i);
    },
  );
});
