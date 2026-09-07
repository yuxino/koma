import type { SVGProps } from "react";

const shapes = {
  "arrow-up-right": <path d="M6 18 18 6M6 6h12v12" />,
  "arrow-up": <path d="M12 20V4m-7 7 7-7 7 7" />,
  "arrow-down": <path d="M12 4v16m-7-7 7 7 7-7" />,
  "arrow-right": <path d="M4 12h16m-7-7 7 7-7 7" />,
  "arrow-left": <path d="M20 12H4m7-7-7 7 7 7" />,
  "corner-down-right": <path d="M5 4v9a3 3 0 0 0 3 3h12m-5-5 5 5-5 5" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.2 6.2A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.8" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  "chevron-left": <path d="m15 5-7 7 7 7" />,
  "chevron-right": <path d="m9 5 7 7-7 7" />,
  alert: <><path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0ZM12 9v4" /><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" /></>,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
};

export type IconName = keyof typeof shapes;

export function Icon({ name, size = 18, className, style, ...props }: Omit<SVGProps<SVGSVGElement>, "name" | "children"> & {
  name: IconName;
  size?: number | string;
}) {
  return <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className ? `koma-icon ${className}` : "koma-icon"}
    style={{ display: "inline-block", flexShrink: 0, verticalAlign: "middle", ...style }}
    {...props}
  >{shapes[name]}</svg>;
}
