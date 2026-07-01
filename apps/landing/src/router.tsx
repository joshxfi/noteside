import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { App } from "./app";
import { ChangelogPage } from "./changelog/page";

// Each page renders its own <SiteHeader/>/<SiteFooter/>, so the root is just the
// outlet for the matched route.
function RootLayout() {
  return <Outlet />;
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: App });
const changelogRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/changelog",
  component: ChangelogPage,
});

const routeTree = rootRoute.addChildren([indexRoute, changelogRoute]);

export const router = createRouter({ routeTree, scrollRestoration: true });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
