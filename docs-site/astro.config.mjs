// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

// GitHub Pages serves this project site under a /sciencedash subpath (both at
// <user>.github.io/sciencedash/ and at danielmurnane.com/sciencedash). `base`
// MUST match that subpath or every asset/link 404s. Override SITE/BASE via env
// if you publish somewhere else.
export default defineConfig({
  site: process.env.SITE_URL ?? "https://danielmurnane.com",
  base: process.env.BASE_PATH ?? "/sciencedash",
  integrations: [
    starlight({
      title: "ScienceDash",
      description:
        "A local-first research operating system for turning curiosity into papers.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/murnanedaniel/sciencedash",
        },
      ],
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", link: "/" },
            { label: "Getting started", link: "/getting-started/" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "How it works", link: "/tutorial/" },
            { label: "Project setup", link: "/setup/" },
            { label: "Remote workhorses", link: "/cluster-integration/" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "Workhorse protocol", link: "/workhorse-protocol/" },
          ],
        },
      ],
    }),
  ],
});
