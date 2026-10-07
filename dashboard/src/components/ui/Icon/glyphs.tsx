import type { SVGProps } from "react";

export const CheckIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export const ChevronDownIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M4 6l4 4 4-4" />
  </svg>
);

export const MinusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    {...props}
  >
    <path d="M4 8h8" />
  </svg>
);

export const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    {...props}
  >
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const ArrowIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

const outline = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.5",
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export const HomeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...outline} {...props}>
    <path d="M2.5 7.5L8 3l5.5 4.5V13h-11z" />
  </svg>
);

export const ListIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...outline} {...props}>
    <path d="M3 4h10M3 8h10M3 12h10" />
  </svg>
);

export const KeyIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...outline} {...props}>
    <circle cx="5.5" cy="10.5" r="2.5" />
    <path d="M7.5 8.5L13 3M11 5l1.5 1.5" />
  </svg>
);

export const ThemeIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...outline} {...props}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11a5.5 5.5 0 000-11z" fill="currentColor" />
  </svg>
);

// A stand-in until the app has its own mark.
export const LogoIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...outline} strokeWidth="2.5" {...props}>
    <path d="M4 5v7M8 8v4M12 3.5v8.5" />
  </svg>
);

export const CloseIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...outline} {...props}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);
