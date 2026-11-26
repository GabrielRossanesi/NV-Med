'use client';

import { useId, useRef, useState, type ReactNode } from 'react';

export default function DetailList({ label, summary, children }: { label: string; summary: ReactNode; children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  return <>
    <button type="button" popoverTarget={id} aria-label={label} className="min-h-9 text-left text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-primary"
      onClick={event => { const rect = event.currentTarget.getBoundingClientRect(); setPosition({ top: Math.max(8, Math.min(rect.bottom + 4, innerHeight - 240)), left: Math.max(8, Math.min(rect.left, innerWidth - 304)) }); }}>
      {summary}
    </button>
    <div ref={panel} id={id} popover="auto" role="region" tabIndex={0} style={position} className="fixed right-auto bottom-auto m-0 max-h-56 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border border-border bg-card-bg p-4 text-sm text-text-primary shadow-sm focus-visible:outline-2 focus-visible:outline-primary" aria-label={label}>
      <p className="mb-2 font-semibold">{label}</p>{children}
    </div>
  </>;
}
