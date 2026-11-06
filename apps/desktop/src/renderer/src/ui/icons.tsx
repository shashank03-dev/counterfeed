import type { SVGProps } from 'react';

/**
 * Together's icon set: one 20px grid, 1.6 stroke, round joins, drawn for this app (no icon dependency).
 * Every icon is aria-hidden; the control that holds it carries the label.
 */
type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 16, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  Home: (p: P) => (
    <Svg {...p}>
      <path d="M3.5 9 10 3.5 16.5 9v6.5a1 1 0 0 1-1 1h-3v-4h-5v4h-3a1 1 0 0 1-1-1Z" />
    </Svg>
  ),
  History: (p: P) => (
    <Svg {...p}>
      <path d="M3.6 10a6.4 6.4 0 1 0 1.9-4.55" />
      <path d="M3.4 3.5v2.6H6" />
      <path d="M10 6.5V10l2.4 1.6" />
    </Svg>
  ),
  Settings: (p: P) => (
    <Svg {...p}>
      <path d="M4 5.5h6M13.5 5.5H16M4 10h2.5M10 10h6M4 14.5h7.5M15 14.5h1" />
      <circle cx="11.75" cy="5.5" r="1.75" />
      <circle cx="8.25" cy="10" r="1.75" />
      <circle cx="13.25" cy="14.5" r="1.75" />
    </Svg>
  ),
  Pulse: (p: P) => (
    <Svg {...p}>
      <path d="M2.5 10.5h3l1.8-4.5 3 8.5 2-6 1.2 2h4" />
    </Svg>
  ),
  Wave: (p: P) => (
    <Svg {...p}>
      <path d="M2.5 10c1.6-4.2 3.3-4.2 5 0s3.4 4.2 5 0 3.4-4.2 5 0" />
    </Svg>
  ),
  Heart: ({ size = 16, ...p }: P) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...p}>
      <path fill="currentColor" d="M10 17.2S2.6 12.9 2.6 7.6A4.1 4.1 0 0 1 10 5.2a4.1 4.1 0 0 1 7.4 2.4c0 5.3-7.4 9.6-7.4 9.6Z" />
    </svg>
  ),
  Mic: (p: P) => (
    <Svg {...p}>
      <rect x="7.25" y="2.75" width="5.5" height="9.5" rx="2.75" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" />
    </Svg>
  ),
  MicOff: (p: P) => (
    <Svg {...p}>
      <path d="M12.75 8.6V5.5a2.75 2.75 0 0 0-5.3-1M7.25 7.8v1.7a2.75 2.75 0 0 0 4.6 2" />
      <path d="M4.5 9.5a5.5 5.5 0 0 0 9.2 4.1M15.5 9.5c0 .5-.06 1-.18 1.45M10 15v2.5M3 3l14 14" />
    </Svg>
  ),
  Video: (p: P) => (
    <Svg {...p}>
      <rect x="2.75" y="5.25" width="10.5" height="9.5" rx="2" />
      <path d="m13.25 8.6 3.5-2.1v7l-3.5-2.1" />
    </Svg>
  ),
  VideoOff: (p: P) => (
    <Svg {...p}>
      <path d="M8.5 5.25h2.75a2 2 0 0 1 2 2v2.5m0 3a2 2 0 0 1-2 2h-6.5a2 2 0 0 1-2-2v-5.5a2 2 0 0 1 1.3-1.87" />
      <path d="m13.25 8.6 3.5-2.1v7l-1.6-1M3 3l14 14" />
    </Svg>
  ),
  Leave: (p: P) => (
    <Svg {...p}>
      <path d="M3.2 11.6c3.9-3.3 9.7-3.3 13.6 0l-.9 2.2-2.9-.9.1-1.8a8.6 8.6 0 0 0-6.2 0l.1 1.8-2.9.9Z" />
    </Svg>
  ),
  Copy: (p: P) => (
    <Svg {...p}>
      <rect x="7" y="7" width="9.5" height="9.5" rx="2" />
      <path d="M13 7V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V11a2 2 0 0 0 2 2H7" />
    </Svg>
  ),
  Check: (p: P) => (
    <Svg {...p}>
      <path d="m4 10.5 3.6 3.5L16 5.5" />
    </Svg>
  ),
  Warn: (p: P) => (
    <Svg {...p}>
      <path d="M10 3.2 17.4 16H2.6Z" />
      <path d="M10 8.2v3.6M10 13.9v.1" />
    </Svg>
  ),
  X: (p: P) => (
    <Svg {...p}>
      <path d="m5 5 10 10M15 5 5 15" />
    </Svg>
  ),
  ChevronRight: (p: P) => (
    <Svg {...p}>
      <path d="m8 4.5 5.5 5.5L8 15.5" />
    </Svg>
  ),
  ArrowRight: (p: P) => (
    <Svg {...p}>
      <path d="M3.5 10h13M11.5 5l5 5-5 5" />
    </Svg>
  ),
  Plus: (p: P) => (
    <Svg {...p}>
      <path d="M10 4v12M4 10h12" />
    </Svg>
  ),
  Sparkle: (p: P) => (
    <Svg {...p}>
      <path d="M10 2.8c.5 3.6 1.6 4.7 5.2 5.2-3.6.5-4.7 1.6-5.2 5.2-.5-3.6-1.6-4.7-5.2-5.2 3.6-.5 4.7-1.6 5.2-5.2ZM15.3 13.3c.2 1.4.7 1.9 2 2-1.3.2-1.8.7-2 2.1-.2-1.4-.7-1.9-2-2.1 1.3-.1 1.8-.6 2-2Z" />
    </Svg>
  ),
  Share: (p: P) => (
    <Svg {...p}>
      <path d="M10 12.5V3.5M6.5 7 10 3.5 13.5 7" />
      <path d="M6 10H5a1.5 1.5 0 0 0-1.5 1.5v3.5A1.5 1.5 0 0 0 5 16.5h10a1.5 1.5 0 0 0 1.5-1.5v-3.5A1.5 1.5 0 0 0 15 10h-1" />
    </Svg>
  ),
  Download: (p: P) => (
    <Svg {...p}>
      <path d="M10 3.5v9M6.5 9 10 12.5 13.5 9M3.5 13.5v1.5a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-1.5" />
    </Svg>
  ),
  Trash: (p: P) => (
    <Svg {...p}>
      <path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 5.5l.7 10a1.5 1.5 0 0 0 1.5 1.4h5.6a1.5 1.5 0 0 0 1.5-1.4l.7-10" />
    </Svg>
  ),
  Sun: (p: P) => (
    <Svg {...p}>
      <circle cx="10" cy="10" r="3.2" />
      <path d="M10 2.5v1.6M10 15.9v1.6M2.5 10h1.6M15.9 10h1.6M4.7 4.7l1.1 1.1M14.2 14.2l1.1 1.1M4.7 15.3l1.1-1.1M14.2 5.8l1.1-1.1" />
    </Svg>
  ),
  Moon: (p: P) => (
    <Svg {...p}>
      <path d="M16.3 12.2A6.8 6.8 0 0 1 7.8 3.7a6.8 6.8 0 1 0 8.5 8.5Z" />
    </Svg>
  ),
  Monitor: (p: P) => (
    <Svg {...p}>
      <rect x="2.75" y="3.75" width="14.5" height="9.5" rx="1.75" />
      <path d="M7 16.5h6M10 13.25v3.25" />
    </Svg>
  ),
  Lock: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="8.75" width="12" height="8" rx="2" />
      <path d="M6.75 8.75V6.5a3.25 3.25 0 0 1 6.5 0v2.25" />
    </Svg>
  ),
  Key: (p: P) => (
    <Svg {...p}>
      <circle cx="6.75" cy="13.25" r="3.25" />
      <path d="m9.1 10.9 7.4-7.4M14 6l2 2M12 8l1.5 1.5" />
    </Svg>
  ),
  Server: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="3.5" width="14" height="5.5" rx="1.5" />
      <rect x="3" y="11" width="14" height="5.5" rx="1.5" />
      <path d="M6 6.25h.01M6 13.75h.01" />
    </Svg>
  ),
  Info: (p: P) => (
    <Svg {...p}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4.5M10 6.6v.1" />
    </Svg>
  ),
  Refresh: (p: P) => (
    <Svg {...p}>
      <path d="M16 10a6 6 0 1 1-1.8-4.3M16 3.5v3h-3" />
    </Svg>
  ),
  Play: (p: P) => (
    <Svg {...p}>
      <path d="M6.5 4.5v11l9-5.5Z" />
    </Svg>
  ),
  Record: ({ size = 16, ...p }: P) => (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...p}>
      <circle cx="10" cy="10" r="4.5" fill="currentColor" />
    </svg>
  ),
  Panel: (p: P) => (
    <Svg {...p}>
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
      <path d="M12.5 3.75v12.5" />
    </Svg>
  ),
  Volume: (p: P) => (
    <Svg {...p}>
      <path d="M3.5 8v4h3l4 3.5v-11L6.5 8ZM13.5 7.5a3.5 3.5 0 0 1 0 5M15.5 5.5a6.4 6.4 0 0 1 0 9" />
    </Svg>
  ),
};
