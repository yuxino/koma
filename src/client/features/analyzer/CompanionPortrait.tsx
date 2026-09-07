export function CompanionPortrait({ className = "", priority = false }: {
  className?: string;
  priority?: boolean;
}) {
  return <span className={`companion-portrait ${className}`.trim()} aria-hidden="true">
    <img src="/koma-ponytail-portrait.webp" alt="" fetchPriority={priority ? "high" : undefined} />
  </span>;
}
