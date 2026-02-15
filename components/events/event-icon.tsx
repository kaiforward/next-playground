"use client";

import { EVENT_TYPE_ICON } from "@/lib/constants/ui";

interface EventIconProps {
  eventType: string;
  className?: string;
}

/** Inline SVG icon for a given event type. Falls back to warning triangle. */
export function EventIcon({ eventType, className = "w-4 h-4" }: EventIconProps) {
  const iconKey = EVENT_TYPE_ICON[eventType] ?? "warning";
  const Icon = ICONS[iconKey] ?? ICONS.warning;
  return <Icon className={className} />;
}

type SvgIconComponent = (props: { className?: string }) => React.ReactElement;

const ICONS: Record<string, SvgIconComponent> = {
  sword: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M17.5 2.5l-1 4-3-3 4-1zM13 5L5.7 12.3a2.5 2.5 0 103.5 3.5L16.5 8.5 13 5zM4.5 17l-2-2 1.5-1.5 2 2L4.5 17z" />
    </svg>
  ),
  virus: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1.07A6.006 6.006 0 0115.93 9H17a1 1 0 110 2h-1.07A6.006 6.006 0 0111 15.93V17a1 1 0 11-2 0v-1.07A6.006 6.006 0 014.07 11H3a1 1 0 110-2h1.07A6.006 6.006 0 019 4.07V3a1 1 0 011-1zm0 4a4 4 0 100 8 4 4 0 000-8zm0 2a2 2 0 110 4 2 2 0 010-4z" clipRule="evenodd" />
    </svg>
  ),
  sparkles: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2l1.5 4.5L16 8l-4.5 1.5L10 14l-1.5-4.5L4 8l4.5-1.5L10 2zM15 12l.75 2.25L18 15l-2.25.75L15 18l-.75-2.25L12 15l2.25-.75L15 12z" />
    </svg>
  ),
  explosion: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2l2 4 3-2-1 4 4 1-3 2 2 3-4-1-1 4-2-3-2 3-1-4-4 1 2-3-3-2 4-1-1-4 3 2 2-4z" />
    </svg>
  ),
  biohazard: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
  pickaxe: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M17 3c-2.5 0-5 1.5-6.5 3.5L8 9l-4.5 4.5a1.5 1.5 0 002 2L10 11l2.5-2.5C14.5 8 16 5.5 17 3z" />
      <path d="M3 17l2.5-2.5M7 9L4 6" />
    </svg>
  ),
  cubes: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M3 7h5v5H3V7zM12 7h5v5h-5V7zM7.5 12.5h5v5h-5v-5z" />
    </svg>
  ),
  "package-x": ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2H3V4zM3 8h14v8a1 1 0 01-1 1H4a1 1 0 01-1-1V8z" />
      <path d="M7.5 11l5 5M12.5 11l-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  ),
  skull: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 2a7 7 0 00-7 7c0 2.5 1.3 4.7 3.5 5.8V17a1 1 0 001 1h5a1 1 0 001-1v-2.2c2.2-1.1 3.5-3.3 3.5-5.8a7 7 0 00-7-7zM7.5 10a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm5 0a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
    </svg>
  ),
  bolt: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M11.983 1.907a.75.75 0 00-1.292-.657l-8.5 9.915A.75.75 0 002.75 12h6.572l-1.305 6.093a.75.75 0 001.292.657l8.5-9.915A.75.75 0 0017.25 8h-6.572l1.305-6.093z" />
    </svg>
  ),
  warning: ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 10a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
    </svg>
  ),
};
