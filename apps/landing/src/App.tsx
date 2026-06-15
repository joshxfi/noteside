import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const GITHUB = "https://github.com/joshxfi/noteside";
const RELEASES = `${GITHUB}/releases`;

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
];

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "light" ? "dark" : "light"))] as const;
}

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
    k: "vim, first-class",
    h: "Modal editing that means it",
    p: "Real modes, motions, operators, and a command line — not a plugin bolted on. Don't know vim? Flip on plain-text mode and just type.",
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

export function App() {
  const [theme, toggleTheme] = useTheme();
  const step = useKeycast();
  useScrollReveal();

  return (
    <>
      <header className="nav">
        <div className="wrap nav-in">
          <a className="brand" href="#top">
            Noteside
          </a>
          <nav className="nav-links">
            <a href="#features">Features</a>
            <a href="#demo">Demo</a>
            <a href="#keys">Keys</a>
            <a href={GITHUB}>GitHub ↗</a>
          </nav>
          <div className="nav-right">
            <button
              className="theme-btn"
              onClick={toggleTheme}
              aria-label="toggle theme"
              title="toggle theme"
            >
              {theme === "light" ? "◐" : "◑"}
            </button>
            <a className="btn btn-primary" href="#download">
              Download
            </a>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero wrap">
          <p className="eyebrow">Offline · local-first · open source</p>
          <h1>A quiet page that keeps up with your hands.</h1>
          <p className="lede">
            Noteside is an offline notebook with vim at its core. Stay on home row, keep every note
            as a plain file, and let the chrome disappear.
          </p>
          <div className="cta-row" id="download">
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
          <p className="cta-note">
            Free forever · open source · <b>no account, no cloud</b>
          </p>
        </section>

        <section className="demo" id="demo">
          <div className="demo-frame reveal">
            <iframe src={DEMO_URL} title="Noteside, running live" />
          </div>
          <p className="demo-cap">
            The real app, running right here. Press <b>i</b> to write, <b>:</b> for commands,{" "}
            <b>⌘K</b>… just kidding — <b>:find</b> to jump anywhere.
          </p>
        </section>

        <section className="features wrap" id="features">
          <div className="section-head reveal">
            <p className="eyebrow">Why Noteside</p>
            <h2>Built for people who would rather not touch the mouse.</h2>
          </div>
          <div className="feat-grid reveal">
            {FEATURES.map((f) => (
              <article className="feat" key={f.k}>
                <div className="feat-k">{f.k}</div>
                <h3>{f.h}</h3>
                <p>{f.p}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="keys wrap" id="keys">
          <div className="section-head reveal">
            <p className="eyebrow">The keyboard layer</p>
            <h2>Learn it in an afternoon. Keep it for years.</h2>
          </div>
          <div className="keycast reveal">
            <div className="kc-caps" key={step} aria-hidden="true">
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
          <div className="keys-cta reveal">
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

      <footer className="foot">
        <div className="wrap">
          <div className="foot-in">
            <div className="foot-brand">
              Noteside<span>notes for keyboard people</span>
            </div>
            <div className="foot-links">
              <div className="foot-col">
                <span className="h">Product</span>
                <a href="#download">Download</a>
                <a href="#demo">Live demo</a>
                <a href="#features">Features</a>
              </div>
              <div className="foot-col">
                <span className="h">Open source</span>
                <a href={GITHUB}>GitHub</a>
                <a href={RELEASES}>Releases</a>
                <a href={`${GITHUB}/issues`}>Issues</a>
              </div>
            </div>
          </div>
          <div className="foot-note">
            <span>Free forever. Open source. Your notes are yours.</span>
            <span>~/.notesiderc</span>
          </div>
        </div>
      </footer>
    </>
  );
}
