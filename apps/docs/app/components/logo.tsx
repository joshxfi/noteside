// Noteside nav lockup — mirrors apps/brand/src/Logo.tsx: a serif "N" mark with a
// plum block cursor, followed by the "Noteside" wordmark with the cursor trailing,
// as if it's still being typed. Styling lives in app.css so it themes with the
// Fumadocs color variables (light nav / dark nav).
export function Logo() {
  return (
    <span className="ns-logo">
      <span className="ns-mark" aria-hidden="true">
        <span className="ns-n">N</span>
        <span className="ns-cur" />
      </span>
      <span className="ns-word">
        Noteside
        <span className="ns-blockcur" aria-hidden="true" />
      </span>
    </span>
  );
}
