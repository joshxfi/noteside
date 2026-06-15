// Noteside logo primitives (see the Brand Guide). The mark is a serif "N" with
// the plum block cursor beside it; the wordmark is "Noteside" with the cursor
// trailing, as if still being typed. Styling lives in the page CSS so each
// surface (light nav, dark panel) can theme it.

export function Wordmark({ style }: { style?: React.CSSProperties }) {
  return (
    <span className="wordtype" style={style}>
      Noteside
      <span className="blockcur" />
    </span>
  );
}

export function LogoMark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? "bmark bmark-lg" : "bmark"} aria-hidden="true">
      <span className="n">N</span>
      <span className="cur" />
    </span>
  );
}
