import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://udhawan97.github.io",
  base: "/Voyalier",
  integrations: [
    starlight({
      title: "Voyalier",
      description:
        "Documentation for the local-first Voyalier travel workspace.",
      favicon: "/favicon.svg",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/udhawan97/Voyalier",
        },
      ],
      customCss: ["./src/styles/custom.css"],
      components: {
        Search: "./src/components/Search.astro",
      },
      sidebar: [
        { label: "Introduction", link: "/introduction/" },
        { label: "Getting started", link: "/getting-started/" },
        {
          label: "Guides",
          items: [
            {
              label: "Trips and the Blueprint",
              link: "/guides/trips-and-blueprint/",
            },
            {
              label: "Importing confirmations",
              link: "/guides/importing-confirmations/",
            },
            {
              label: "Readiness and official advice",
              link: "/guides/readiness-and-advice/",
            },
            {
              label: "Offline packs, recommendations, and maps",
              link: "/guides/offline-packs-and-maps/",
            },
            { label: "AI assist (BYOK)", link: "/guides/ai-assist/" },
            { label: "The encrypted vault", link: "/guides/encrypted-vault/" },
          ],
        },
        { label: "Troubleshooting", link: "/troubleshooting/" },
        { label: "Architecture", link: "/architecture/" },
        { label: "Privacy and trust", link: "/privacy/" },
        { label: "Roadmap", link: "/roadmap/" },
      ],
    }),
  ],
});
