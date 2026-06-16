import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Link } from "react-router";
import { baseOptions } from "@/lib/layout.shared";

// Rendered by the root ErrorBoundary on a 404 (not a route of its own).
export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="p-4 flex flex-col items-center justify-center text-center flex-1">
        <h1 className="text-xl font-bold mb-2">Not Found</h1>
        <p className="text-fd-muted-foreground mb-4">This page could not be found.</p>
        <Link
          className="text-sm bg-fd-primary text-fd-primary-foreground rounded-full font-medium px-4 py-2.5"
          to="/"
        >
          Back to the docs
        </Link>
      </div>
    </HomeLayout>
  );
}
