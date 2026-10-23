export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 40" className={className} fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
      <path d="M4 36 L22 8 L32 22 L40 12 L60 36" />
      <path d="M17 36 L28 20" opacity=".55" />
    </svg>
  );
}
