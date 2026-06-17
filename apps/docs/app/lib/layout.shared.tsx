import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { gitConfig } from "./shared";
import { Logo } from "@/components/logo";

// Link back to the product site (override with VITE_SITE_URL in dev).
const SITE_URL = import.meta.env.VITE_SITE_URL ?? "https://noteside.app";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
    links: [
      { text: "Noteside", url: SITE_URL, external: true },
      { text: "Built by Josh Daniel", url: "https://github.com/joshxfi", external: true },
    ],
  };
}
