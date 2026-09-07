export function CompanionPortrait({ className = "", priority = false, variant = "portrait" }: {
  className?: string;
  priority?: boolean;
  variant?: "portrait" | "logo";
}) {
  return <span className={`companion-portrait ${className}`.trim()} aria-hidden="true">
    <img src={variant === "logo" ? "/koma-ponytail-logo.png" : "/koma-ponytail-portrait.webp"} alt="" fetchPriority={priority ? "high" : undefined} />
  </span>;
}
