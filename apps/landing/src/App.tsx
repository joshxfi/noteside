import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { LogoMark, Wordmark } from "./Logo";

const GITHUB = "https://github.com/joshxfi/noteside";
const RELEASES = `${GITHUB}/releases`;
const AUTHOR = "https://github.com/joshxfi";
// The docs site (docs.noteside.app in prod). Override with VITE_DOCS_URL — e.g.
// http://localhost:3002 when running `pnpm dev:docs` locally.
const DOCS = import.meta.env.VITE_DOCS_URL ?? "https://docs.noteside.app";

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
    p: "Full modal vim if you want it — real modes, motions, operators, a command line. Don't want vim? Turn it off and run everything from ⌘-shortcuts, a searchable command palette, and ⌘F find. Either way, the mouse stays parked.",
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
  {
    k: "fast fuzzy search",
    h: "Find anything in a keystroke",
    p: "Typo-resistant, frecency-ranked search across paths and contents, powered by fff. The note you want is two keys away.",
  },
];

const eyebrow = "font-mono text-[12.5px] tracking-[0.16em] uppercase text-accent mb-3.5";
const sectionH2 =
  "font-serif font-medium text-[clamp(1.9rem,4vw,2.9rem)] tracking-[-0.02em] max-w-[20ch] mx-auto leading-[1.08] text-balance";

export function App() {
  const step = useKeycast();
  useScrollReveal();

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-rule-soft bg-paper/90 backdrop-blur-[10px]">
        <div className="wrap flex h-[62px] items-center gap-[22px]">
          <a
            className="inline-block whitespace-nowrap font-serif text-[22px] font-semibold tracking-[-0.01em]"
            href="#top"
          >
            <Wordmark />
          </a>
          <nav className="ml-3.5 flex gap-[22px] font-mono text-[13px] text-ink-soft max-sm:hidden">
            <a className="whitespace-nowrap hover:text-ink" href="#features">
              Features
            </a>
            <a className="whitespace-nowrap hover:text-ink" href="#demo">
              Demo
            </a>
            <a className="whitespace-nowrap hover:text-ink" href="#keys">
              Keys
            </a>
            <a className="whitespace-nowrap hover:text-ink" href={DOCS}>
              Docs ↗
            </a>
            <a className="whitespace-nowrap hover:text-ink" href={GITHUB}>
              GitHub ↗
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <a className="btn btn-ghost" href={DOCS}>
              Documentation
            </a>
            <a className="btn btn-primary" href="#download">
              Download
            </a>
          </div>
        </div>
      </header>

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
          <div className="mt-[34px] mb-3.5 flex flex-wrap justify-center gap-3" id="download">
            <a className="btn btn-primary" href={RELEASES}>
              Download for macOS
            </a>
            <a className="btn btn-ghost" href={RELEASES}>
              Windows
            </a>
            <a className="btn btn-ghost" href={RELEASES}>
              Linux
            </a>
          </div>
          <p className="font-mono text-[12.5px] text-ink-faint">
            Free forever · open source ·{" "}
            <b className="font-semibold text-ink-soft">no account, no cloud</b>
          </p>
        </section>

        <section className="pt-10 pb-24" id="demo">
          <div className="reveal relative mx-auto aspect-[1120/740] w-[min(1120px,94vw)] overflow-hidden rounded-[18px] border border-rule-soft bg-paper-2 shadow-[var(--shadow)]">
            <iframe
              className="absolute inset-0 block h-full w-full border-0"
              src={DEMO_URL}
              title="Noteside, running live"
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
                <a className="whitespace-nowrap hover:text-accent" href="#download">
                  Download
                </a>
                <a className="whitespace-nowrap hover:text-accent" href={DOCS}>
                  Documentation
                </a>
                <a className="whitespace-nowrap hover:text-accent" href="#demo">
                  Live demo
                </a>
                <a className="whitespace-nowrap hover:text-accent" href="#features">
                  Features
                </a>
              </div>
              <div className="flex flex-col gap-2.5">
                <span className="text-[11px] tracking-[0.12em] uppercase whitespace-nowrap text-ink-faint">
                  Open source
                </span>
                <a className="whitespace-nowrap hover:text-accent" href={GITHUB}>
                  GitHub
                </a>
                <a className="whitespace-nowrap hover:text-accent" href={RELEASES}>
                  Releases
                </a>
                <a className="whitespace-nowrap hover:text-accent" href={`${GITHUB}/issues`}>
                  Issues
                </a>
              </div>
            </div>
          </div>
          <div className="mt-[30px] flex w-full flex-wrap justify-between gap-4 border-t border-rule-soft pt-[22px] font-mono text-[12px] text-ink-faint">
            <span>
              Free forever. Open source. Built by{" "}
              <a className="text-ink-soft hover:text-accent" href={AUTHOR}>
                Josh Daniel
              </a>
              .
            </span>
            <span>~/.notesiderc</span>
          </div>
        </div>
      </footer>
    </>
  );
}
