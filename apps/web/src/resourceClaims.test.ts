import context from "../../../CONTEXT.md?raw";
import roadmap from "../../../docs/roadmap/ROADMAP.md?raw";
import gettingStarted from "../../../docs-site/src/content/docs/getting-started.mdx?raw";
import privacy from "../../../docs-site/src/content/docs/privacy.mdx?raw";
import resources from "../../../docs-site/src/content/docs/guides/research-resources.mdx?raw";

const currentClaimFiles = [
  ["CONTEXT.md", context],
  ["ROADMAP.md", roadmap],
  ["getting-started.mdx", gettingStarted],
  ["privacy.mdx", privacy],
  ["research-resources.mdx", resources],
] as const;

describe("research-resource public claims", () => {
  it.each(currentClaimFiles)(
    "%s does not promise file-resource capture",
    (_path, source) => {
      expect(source).not.toMatch(/links? (?:or|and) files?/i);
      expect(source).not.toMatch(/(?:drop|dropped|dropping) (?:in )?a file/i);
    },
  );
});
