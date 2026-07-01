import { Fragment, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useDownloads } from "./downloads";
import type { Cta } from "./downloads";
import { LogoMark } from "./logo";
import { DOCS, SiteFooter, SiteHeader } from "./chrome";
import { useHead } from "./head";

// Direct file downloads save in place; page links open in a new tab.
const linkProps = (c: Cta) =>
  c.download ? { rel: "noopener" } : { target: "_blank", rel: "noopener noreferrer" };

// The live demo embeds the desktop app's web build. In dev, point at the
// desktop Vite server (started by `turbo dev`); in prod, at /demo, populated by
// `pnpm demo:build`. Override with VITE_DEMO_URL.
const DEMO_URL =
  import.meta.env.VITE_DEMO_URL ??
  (import.meta.env.DEV ? "http://localhost:1420/?embed=1" : "demo/index.html?embed=1");

interface Step {
  caps: [string, boolean][];
  cap: ReactNode;
}

const STEPS: Step[] = [
  {
    caps: [["i", true]],
    cap: (
      <>
        press <span className="k">i</span> to start writing
      </>
    ),
  },
  {
    caps: [
      ["j", true],
      ["j", true],
    ],
    cap: (
      <>
        <span className="k">jj</span> slips back to normal mode
      </>
    ),
  },
  {
    caps: [
      ["d", true],
      ["d", true],
    ],
    cap: (
      <>
        <span className="k">dd</span> deletes the whole line
      </>
    ),
  },
  {
    caps: [
      [":", true],
      ["w", false],
    ],
    cap: (
      <>
        <span className="k">:w</span> writes the file to disk
      </>
    ),
  },
  {
    caps: [
      [":", true],
      ["f", false],
      ["i", false],
      ["n", false],
      ["d", false],
    ],
    cap: (
      <>
        <span className="k">:find</span> jumps to any note
      </>
    ),
  },
  {
    caps: [
      ["/", true],
      ["f", false],
      ["i", false],
      ["g", false],
    ],
    cap: (
      <>
        <span className="k">/</span> searches inside the page
      </>
    ),
  },
  {
    caps: [
      ["⌘", true],
      ["⇧", true],
      ["P", true],
    ],
    cap: (
      <>
        <span className="k">⌘⇧P</span> opens the command palette — no vim required
      </>
    ),
  },
];

// Adds `.in` to every `.reveal` element as it scrolls into view.
function useScrollReveal() {
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

function useKeycast() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 2600);
    return () => clearInterval(id);
  }, []);
  return step;
}

const FEATURES = [
  {
    k: "keyboard, first-class",
    h: "Vim or ⌘-shortcuts — your call",
    p: "Full modal vim if you want it — real modes, motions, operators, a command line. Don't want vim? Turn it off and run everything from ⌘-shortcuts, a searchable command palette, and ⌘F find. Rebind any chord right from the cheatsheet (⌘/). Either way, the mouse stays parked.",
  },
  {
    k: "fast & lightweight",
    h: "Native speed, no bloat",
    p: "A Rust core over your OS's native webview — it launches instantly, stays light on memory, and ships as a small native binary. Even fuzzy search across 50,000 notes stays sub-millisecond.",
  },
  {
    k: "offline & local-first",
    h: "Everything stays on your machine",
    p: "No account, no sync, no cloud round-trip. Close the lid and your words are still here, exactly where the cursor left them.",
  },
  {
    k: "your notes are files",
    h: "Plain Markdown on your disk",
    p: "Folders of text you can grep, back up, and read in any editor. No database, no lock-in. Your notes outlive the app.",
  },
];

const eyebrow = "font-mono text-[12.5px] tracking-[0.16em] uppercase text-accent mb-3.5";
const sectionH2 =
  "font-serif font-medium text-[clamp(1.9rem,4vw,2.9rem)] tracking-[-0.02em] max-w-[20ch] mx-auto leading-[1.08] text-balance";

export function App() {
  useHead("Noteside — notes for keyboard people", "https://noteside.app/");
  const step = useKeycast();
  const dl = useDownloads();
  useScrollReveal();

  return (
    <>
      <SiteHeader />

      <main id="top">
        <section className="wrap pt-[92px] pb-10 text-center max-sm:pt-16 max-sm:pb-[30px]">
          <div className="mb-[30px] flex justify-center">
            <LogoMark large />
          </div>
          <h1 className="mx-auto max-w-[24ch] font-serif text-[clamp(2.5rem,6.2vw,4.7rem)] font-medium leading-[1.04] tracking-[-0.022em] text-balance">
            A quiet page that keeps up with your hands.
          </h1>
          <p className="mx-auto mt-6 max-w-[39rem] text-[clamp(1.05rem,2.2vw,1.32rem)] leading-[1.55] text-ink-soft text-pretty">
            Noteside is an offline notebook built for the keyboard — drive it with full vim, or the
            everyday shortcuts you already know.
          </p>
          <div className="mt-[34px] mb-3.5 flex flex-wrap justify-center gap-3" id="get">
            <a className="btn btn-primary" href={dl.primary.href} {...linkProps(dl.primary)}>
              {dl.primary.label}
            </a>
            <a className="btn btn-ghost max-sm:hidden" href="#demo">
              Try the live demo
            </a>
          </div>
          <p className="mx-auto flex max-w-[46rem] flex-wrap items-center justify-center gap-x-2 gap-y-1 font-mono text-[12.5px] text-ink-faint">
            <span>Free forever · open source</span>
            {dl.platforms.map((p) => (
              <Fragment key={p.os}>
                <span aria-hidden="true">·</span>
                <a
                  className={
                    "underline underline-offset-2 hover:text-accent " +
                    (p.os === dl.os ? "font-semibold text-ink-soft" : "text-ink-soft")
                  }
                  href={p.href}
                  {...linkProps(p)}
                >
                  {p.label}
                </a>
              </Fragment>
            ))}
            {dl.version ? (
              <>
                <span aria-hidden="true">·</span>
                <a
                  className="underline underline-offset-2 hover:text-accent"
                  href={dl.allDownloads.href}
                  title="All downloads"
                  {...linkProps(dl.allDownloads)}
                >
                  {dl.version}
                </a>
              </>
            ) : null}
          </p>
          {dl.os === "mac" && (
            <p className="mx-auto mt-4 max-w-[32rem] font-mono text-[11px] leading-[1.5] text-ink-faint">
              macOS shows a one-time warning for unsigned apps.{" "}
              <a
                className="whitespace-nowrap underline underline-offset-2 hover:text-accent"
                href={`${DOCS}/getting-started`}
                target="_blank"
                rel="noopener noreferrer"
              >
                How to open ↗
              </a>
            </p>
          )}
        </section>

        <section className="pt-10 pb-24 max-sm:hidden" id="demo">
          <div className="reveal relative mx-auto aspect-[1120/740] w-[min(1120px,94vw)] overflow-hidden rounded-[18px] border border-rule-soft bg-paper-2 shadow-[var(--shadow)]">
            <iframe
              className="absolute inset-0 block h-full w-full border-0"
              src={DEMO_URL}
              title="Noteside, running live"
              loading="lazy"
            />
          </div>
          <p className="mt-[22px] text-center font-mono text-[13px] text-ink-faint">
            The real app, running right here. Press <b className="text-accent">i</b> to write,{" "}
            <b className="text-accent">:</b> for commands, and <b className="text-accent">:find</b>{" "}
            to jump anywhere.
          </p>
        </section>

        <section className="wrap border-t border-rule-soft pt-[30px] pb-24" id="features">
          <div className="reveal mb-[46px] text-center">
            <p className={eyebrow}>Why Noteside</p>
            <h2 className={sectionH2}>Built for people who would rather not touch the mouse.</h2>
          </div>
          <div className="reveal grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-rule-soft bg-rule-soft max-sm:grid-cols-1">
            {FEATURES.map((f) => (
              <article className="bg-paper px-8 py-[34px]" key={f.k}>
                <div className="mb-3.5 font-mono text-[11.5px] tracking-[0.13em] uppercase text-accent">
                  {f.k}
                </div>
                <h3 className="mb-2.5 font-serif text-2xl font-medium tracking-[-0.01em]">{f.h}</h3>
                <p className="text-[1.04rem] leading-[1.55] text-ink-soft text-pretty">{f.p}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="wrap border-t border-rule-soft pt-16 pb-[100px] text-center" id="keys">
          <div className="reveal mb-[46px] text-center">
            <p className={eyebrow}>The keyboard layer</p>
            <h2 className={sectionH2}>Learn it in an afternoon. Keep it for years.</h2>
          </div>
          <div className="reveal mt-3.5 flex min-h-[200px] flex-col items-center justify-center gap-7">
            <div className="flex min-h-16 items-center gap-3" key={step} aria-hidden="true">
              {STEPS[step].caps.map(([ch, on], i) => (
                <span
                  key={i}
                  className={"kc-key" + (on ? " on" : "")}
                  style={{ animationDelay: i * 0.06 + "s" }}
                >
                  {ch === " " ? "␣" : ch}
                </span>
              ))}
            </div>
            <div className="kc-cap" key={"cap" + step}>
              {STEPS[step].cap}
            </div>
          </div>
          <div className="reveal mt-[26px]">
            <a
              className="btn btn-ghost"
              href="https://www.vim-hero.com/"
              target="_blank"
              rel="noopener"
            >
              New to vim? Learn the keybindings →
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
