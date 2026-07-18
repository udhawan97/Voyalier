# Third-party notices

This file is the distribution-time registry for bundled software, fonts, model files, icons, map data, document parsers, and other redistributable assets.

The initial scaffold contains source dependencies managed through Cargo and pnpm lockfiles. Before the first public binary release, CI must generate and review a complete software bill of materials and this file must list every attribution that needs to travel with the product.

Travel research results retain their own per-source attribution and licensing metadata; see [the data-source policy](docs/data/DATA_SOURCES.md).

## Bundled fonts

Voyalier self-hosts Latin + Latin-Extended subsets of two typefaces so the
interface renders its intended type identity without any third-party (web
font CDN) request at runtime. Both are licensed under the **SIL Open Font
License, Version 1.1** (<https://openfontlicense.org>).

| Font                    | Designer / Foundry             | Weights bundled | Where            |
| ----------------------- | ------------------------------ | --------------- | ---------------- |
| **Zen Kaku Gothic New** | Yoshimichi Ohira / Zen Project | 400, 500, 700   | UI text          |
| **Shippori Mincho**     | FONTDASU                       | 500, 600        | Display headings |

The `.woff2` subset files live in `apps/web/public/fonts/` (product) and, for
the documentation site, `docs-site/public/fonts/`. Only Latin ranges are
bundled; the fonts' full CJK ranges are intentionally omitted. The unmodified
OFL text ships alongside the font files in each directory as `OFL.txt`.
