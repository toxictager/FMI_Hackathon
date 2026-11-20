// Routique logo: a map pin with a dotted route leading to it, in the site's teal green.
// Colours live in styles.css (--logo-bg = pin, --logo-fg = pin's inner dot) so they can be
// tuned in one place; the dark theme uses a lighter mint with a dark dot.

export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <path
        d="M14 88 C30 88 34 70 50 70"
        fill="none"
        stroke="var(--logo-bg)"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray="2 9"
        opacity="0.65"
      />
      <path d="M60 8a26 26 0 0 0-26 26c0 19 26 46 26 46s26-27 26-46A26 26 0 0 0 60 8z" fill="var(--logo-bg)" />
      <circle cx="60" cy="34" r="10" fill="var(--logo-fg)" />
      <circle cx="14" cy="88" r="6" fill="var(--logo-bg)" />
    </svg>
  );
}
