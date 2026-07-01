// Shared site chrome (header + footer) used by every landing page (home +
// changelog). In-page section links are absolute `/#…` so they work from any
// page — from /changelog they navigate home and scroll.
import { Link } from "@tanstack/react-router";
import { GITHUB, RELEASES } from "./downloads";
import { Wordmark } from "./logo";

// The docs site (docs.noteside.app in prod). Override with VITE_DOCS_URL.
export const DOCS = import.meta.env.VITE_DOCS_URL ?? "https://docs.noteside.app";
const AUTHOR = "https://github.com/joshxfi";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-rule-soft bg-paper/88 backdrop-blur-[10px]">
      <div className="wrap flex h-[62px] items-center gap-[22px]">
        <Link
          className="inline-block whitespace-nowrap font-serif text-[22px] font-semibold tracking-[-0.01em]"
          to="/"
        >
          <Wordmark />
        </Link>
        <nav className="ml-3.5 flex gap-[22px] font-mono text-[13px] text-ink-soft max-sm:hidden">
          <Link className="whitespace-nowrap hover:text-ink" to="/changelog">
            Changelog
          </Link>
          <a className="whitespace-nowrap hover:text-ink" href={DOCS}>
            Docs
          </a>
          <a
            className="whitespace-nowrap hover:text-ink"
            href={GITHUB}
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <a className="btn btn-ghost" href={DOCS}>
            Documentation
          </a>
          <a className="btn btn-primary" href="/#get">
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-rule-soft bg-paper-2 pt-[54px] pb-[60px]">
      <div className="wrap">
        <div className="flex flex-wrap items-start justify-between gap-7">
          <div className="flex flex-col gap-1 font-serif text-2xl font-semibold">
            <Wordmark />
            <span className="font-mono text-[11px] font-normal tracking-[0.03em] text-ink-faint">
              notes for keyboard people
            </span>
          </div>
          <div className="flex gap-[30px] font-mono text-[13px] text-ink-soft">
            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] tracking-[0.12em] uppercase whitespace-nowrap text-ink-faint">
                Product
              </span>
              <a className="whitespace-nowrap hover:text-accent" href={DOCS}>
                Documentation
              </a>
              <a className="whitespace-nowrap hover:text-accent" href="/#get">
                Get started
              </a>
              <Link className="whitespace-nowrap hover:text-accent" to="/changelog">
                Changelog
              </Link>
              <a className="whitespace-nowrap hover:text-accent max-sm:hidden" href="/#demo">
                Live demo
              </a>
              <a className="whitespace-nowrap hover:text-accent" href="/#features">
                Features
              </a>
            </div>
            <div className="flex flex-col gap-2.5">
              <span className="text-[11px] tracking-[0.12em] uppercase whitespace-nowrap text-ink-faint">
                Open source
              </span>
              <a
                className="whitespace-nowrap hover:text-accent"
                href={GITHUB}
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              <a
                className="whitespace-nowrap hover:text-accent"
                href={RELEASES}
                target="_blank"
                rel="noopener noreferrer"
              >
                Releases
              </a>
              <a
                className="whitespace-nowrap hover:text-accent"
                href={`${GITHUB}/issues`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Issues
              </a>
            </div>
          </div>
        </div>
        <div className="mt-[30px] flex w-full flex-wrap justify-between gap-4 border-t border-rule-soft pt-[22px] font-mono text-[12px] text-ink-faint">
          <span>
            Free forever. Open source. Built by{" "}
            <a
              className="text-ink-soft hover:text-accent"
              href={AUTHOR}
              target="_blank"
              rel="noopener noreferrer"
            >
              Josh Daniel
            </a>
            .
          </span>
          <span>~/.notesiderc</span>
        </div>
      </div>
    </footer>
  );
}
