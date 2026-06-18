// Noteside Brand Guide — faithful port of the design file.
import { Wordmark } from "./logo";

// The mark at an explicit size (the guide hand-tunes each step).
function Bmark({
  tile,
  n,
  curW,
  curH,
  gap,
}: {
  tile: number;
  n: number;
  curW: number;
  curH: number;
  gap: number;
}) {
  return (
    <span className="bmark" style={{ width: tile, height: tile, gap }}>
      <span className="n" style={{ fontSize: n }}>
        N
      </span>
      <span className="cur" style={{ width: curW, height: curH }} />
    </span>
  );
}

const SWATCHES: { nm: string; val: string; role: string; bg: string; ring?: boolean }[] = [
  { nm: "Plum", val: "oklch(0.565 0.095 350)", role: "ACCENT · CURSOR", bg: "var(--plum)" },
  { nm: "Ink", val: "oklch(0.315 0.022 53)", role: "TEXT", bg: "var(--ink)" },
  { nm: "Ink soft", val: "oklch(0.470 0.020 56)", role: "SECONDARY", bg: "var(--ink-soft)" },
  { nm: "Ink faint", val: "oklch(0.635 0.016 60)", role: "MUTED · META", bg: "var(--ink-faint)" },
  { nm: "Paper", val: "oklch(0.971 0.011 79)", role: "BACKGROUND", bg: "var(--paper)", ring: true },
  { nm: "Paper 2", val: "oklch(0.948 0.014 78)", role: "PANELS", bg: "var(--paper-2)" },
  { nm: "Rule", val: "oklch(0.886 0.016 75)", role: "BORDERS", bg: "var(--rule)" },
  { nm: "Ink ground", val: "oklch(0.222 0.012 58)", role: "DARK MODE BG", bg: "var(--ink-bg)" },
];

export function BrandGuide() {
  return (
    <div className="wrap">
      <header className="top">
        <p className="kicker">Brand guide</p>
        <h1>Noteside</h1>
        <p>
          A notebook for keyboard people. Warm paper, a literary hand, and one quiet plum cursor.
        </p>
      </header>

      {/* 01 · MARK */}
      <section>
        <div className="sec-h">
          <span className="num">01</span>
          <h2>The mark</h2>
          <span className="note">
            A serif “N” with the plum block cursor beside it — a zoom-in of the wordmark’s first
            letter.
          </span>
        </div>
        <div className="grid2">
          <div className="panel">
            <Bmark tile={128} n={74} curW={12} curH={54} gap={5} />
            <span className="lab">on paper</span>
          </div>
          <div className="panel dark">
            <Bmark tile={128} n={74} curW={12} curH={54} gap={5} />
            <span className="lab">on ink</span>
          </div>
        </div>
        <div className="panel" style={{ alignItems: "flex-start", marginTop: 20 }}>
          <span className="lab">Legibility down to a favicon</span>
          <div className="sizes">
            <div className="cell">
              <Bmark tile={72} n={42} curW={7} curH={30} gap={3} />
              <span className="lab">72</span>
            </div>
            <div className="cell">
              <Bmark tile={48} n={28} curW={5} curH={20} gap={2} />
              <span className="lab">48</span>
            </div>
            <div className="cell">
              <Bmark tile={32} n={19} curW={3.5} curH={13} gap={1.5} />
              <span className="lab">32</span>
            </div>
            <div className="cell">
              <img
                src="/apple-touch-icon.png"
                alt="favicon"
                width={32}
                height={32}
                style={{ borderRadius: 7, display: "block" }}
              />
              <span className="lab">favicon*</span>
            </div>
          </div>
        </div>
        <p
          style={{
            fontFamily: "var(--mono)",
            fontSize: 11,
            color: "var(--ink-faint)",
            margin: "14px 2px 0",
            lineHeight: 1.5,
          }}
        >
          *The favicon uses a filled plum tile (cream “N”) so it stays legible against light browser
          tab strips.
        </p>
      </section>

      {/* 02 · WORDMARK */}
      <section>
        <div className="sec-h">
          <span className="num">02</span>
          <h2>The wordmark</h2>
          <span className="note">
            Newsreader, with the block cursor trailing — as if the name is still being typed.
          </span>
        </div>
        <div className="grid2">
          <div className="panel">
            <Wordmark style={{ fontSize: 54 }} />
            <span className="lab">on paper</span>
          </div>
          <div className="panel dark">
            <Wordmark style={{ fontSize: 54 }} />
            <span className="lab">on ink</span>
          </div>
        </div>
      </section>

      {/* 03 · MOTIF */}
      <section>
        <div className="sec-h">
          <span className="num">03</span>
          <h2>The cursor motif</h2>
        </div>
        <div className="motif">
          <div className="demo">
            <span className="big">
              <span className="cell">N</span>ormal
            </span>
          </div>
          <div>
            <p>
              In vim, the block cursor doesn’t blink beside a letter — it sits <b>on</b> it and
              inverts it.
            </p>
            <p>
              That single plum block is Noteside’s whole identity: it rests on the “N” in the mark,
              and trails the wordmark like a live caret. Use it sparingly — <b>one</b> cursor per
              lockup, always in the plum accent.
            </p>
          </div>
        </div>
      </section>

      {/* 04 · COLOR */}
      <section>
        <div className="sec-h">
          <span className="num">04</span>
          <h2>Color</h2>
          <span className="note">
            Warm neutrals from cream to cocoa, with a single plum accent.
          </span>
        </div>
        <div className="swatches">
          {SWATCHES.map((s) => (
            <div className="sw" key={s.nm}>
              <div
                className="chip"
                style={{
                  background: s.bg,
                  boxShadow: s.ring ? "inset 0 0 0 1px var(--rule)" : undefined,
                }}
              />
              <div className="meta">
                <div className="nm">{s.nm}</div>
                <div className="val">{s.val}</div>
                <div className="role">{s.role}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 05 · TYPE */}
      <section>
        <div className="sec-h">
          <span className="num">05</span>
          <h2>Typography</h2>
          <span className="note">
            A literary serif for prose; a precise mono for the machinery.
          </span>
        </div>
        <div className="typecard">
          <div className="tc-h">
            <span className="tc-name specimen-serif" style={{ fontSize: "1.4rem" }}>
              Newsreader
            </span>
            <span className="tc-role">Display · prose · wordmark</span>
          </div>
          <div className="specimen-serif glyphline">AaBbCcGg 0123 — quiet by default</div>
          <div className="scale specimen-serif">
            <div className="row">
              <span className="tag">Medium 500</span>
              <span style={{ fontSize: "1.5rem" }}>The page is the interface.</span>
            </div>
            <div className="row">
              <span className="tag">Italic 400</span>
              <span style={{ fontSize: "1.5rem", fontStyle: "italic" }}>Keep the pen moving.</span>
            </div>
          </div>
        </div>
        <div className="typecard">
          <div className="tc-h">
            <span className="tc-name specimen-mono" style={{ fontSize: "1.25rem" }}>
              IBM Plex Mono
            </span>
            <span className="tc-role">UI · status bar · code</span>
          </div>
          <div className="specimen-mono glyphline" style={{ fontSize: "2rem" }}>
            AaBbCc 0123 :w /find
          </div>
          <div className="scale specimen-mono">
            <div className="row">
              <span className="tag">Regular 400</span>
              <span style={{ fontSize: "1rem" }}>NORMAL · 142 words · 1:1</span>
            </div>
            <div className="row">
              <span className="tag">Medium 500</span>
              <span style={{ fontSize: "1rem" }}>imap jj &lt;Esc&gt;</span>
            </div>
          </div>
        </div>
      </section>

      {/* 06 · USAGE */}
      <section>
        <div className="sec-h">
          <span className="num">06</span>
          <h2>Using the logo</h2>
        </div>
        <div className="rules">
          <div className="rule-card do">
            <span className="mk">✓</span>
            <p>
              Use the mark <b>or</b> the wordmark on its own in UI — nav, sidebar, dock.
            </p>
          </div>
          <div className="rule-card do">
            <span className="mk">✓</span>
            <p>Give the mark clear space of at least half its height on every side.</p>
          </div>
          <div className="rule-card dont">
            <span className="mk">✕</span>
            <p>Don’t pair the mark and wordmark side by side in chrome — one or the other.</p>
          </div>
          <div className="rule-card dont">
            <span className="mk">✕</span>
            <p>Don’t recolor the cursor, add gradients, or set the wordmark in another typeface.</p>
          </div>
        </div>
      </section>

      <footer>
        <span>Noteside — notes for keyboard people</span>
        <span>~/.notesiderc</span>
      </footer>
    </div>
  );
}
