import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { gitConfig } from "./shared";
import { Logo } from "@/components/logo";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo />,
    },
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
