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
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/udhawan97/Voyalier",
        },
      ],
      customCss: ["./src/styles/custom.css"],
      sidebar: [
        { label: "Introduction", link: "/introduction/" },
        { label: "Getting started", link: "/getting-started/" },
        { label: "Architecture", link: "/architecture/" },
        { label: "Privacy and trust", link: "/privacy/" },
        { label: "Roadmap", link: "/roadmap/" },
      ],
    }),
  ],
});
