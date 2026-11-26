'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';

/** Native top-layer popover avoids clipping inside scrollable tables. */
export default function ContextMenu({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [open, setOpen] = useState(false);
  function positionMenu(height = 420) {
    const rect = trigger.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.right - 256, window.innerWidth - 264)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - height - 8)) });
  }
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      panel.current?.hidePopover();
    };
    window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="inline-flex size-11 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-primary"
      popoverTarget={id} aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => positionMenu()}
      onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); positionMenu(); panel.current?.showPopover(); panel.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); } }}>
      <MoreHorizontal className="size-5" aria-hidden="true"/>
    </button>
    <div id={id} ref={panel} popover="auto" role="menu" aria-label={label} style={position}
      onToggle={event => { const shown = event.newState === 'open'; setOpen(shown); if (shown) positionMenu(panel.current!.getBoundingClientRect().height); }}
      onClick={event => { if ((event.target as HTMLElement).closest('[role="menuitem"]')) panel.current?.hidePopover(); }}
      onKeyDown={event => {
        const items = Array.from(panel.current!.querySelectorAll<HTMLElement>('[role="menuitem"]'));
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
        if (event.key === 'Escape') { panel.current?.hidePopover(); trigger.current?.focus(); }
      }}
      className="fixed right-auto bottom-auto m-0 max-h-[calc(100dvh-1rem)] w-64 overflow-y-auto rounded-xl border border-border bg-card-bg p-1.5 text-sm text-text-primary shadow-sm [&_[role=menuitem]]:flex [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:w-full [&_[role=menuitem]]:items-center [&_[role=menuitem]]:rounded-lg [&_[role=menuitem]]:px-3 [&_[role=menuitem]]:text-left [&_[role=menuitem]]:hover:bg-state-hover [&_[role=menuitem]]:focus-visible:outline-2 [&_[role=menuitem]]:focus-visible:outline-primary">
      {children}
    </div>
  </>;
}
