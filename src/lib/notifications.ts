'use client';

import { toast } from 'sonner';

const duration = {
  success: 3500,
  info: 4500,
  warning: 7000,
  error: 7000,
} as const;

type NotificationKind = keyof typeof duration;
type NotificationOptions = { description?: string; persistent?: boolean; withinDialog?: boolean };

export const visibleNotifications = 3;
const dialogScopes = new Set<string>();

export function registerNotificationDialog(id: string) {
  dialogScopes.add(id);
  return () => {
    dialogScopes.delete(id);
    for (const item of toast.getToasts()) {
      if ('toasterId' in item && item.toasterId === id) toast.dismiss(item.id);
    }
  };
}

function show(kind: NotificationKind, title: string, options: NotificationOptions = {}) {
  // Confirmations typically close the submitting dialog. Errors are shown where the user can retry.
  const withinDialog = options.withinDialog ?? kind === 'error';
  const toasterId = withinDialog ? [...dialogScopes].at(-1) : undefined;
  const id = JSON.stringify([toasterId, kind, title, options.description]);
  const active = toast.getToasts();
  if (active.some(item => item.id === id)) return;

  const timed = active.filter(item => 'toasterId' in item && item.toasterId === toasterId && item.duration !== Infinity);
  if (timed.length >= visibleNotifications) toast.dismiss(timed[0].id);

  toast[kind](title, {
    id,
    toasterId,
    description: options.description,
    duration: options.persistent ? Infinity : duration[kind],
  });
}

export const notify = {
  success: (title: string, options?: NotificationOptions) => show('success', title, options),
  info: (title: string, options?: NotificationOptions) => show('info', title, options),
  warning: (title: string, options?: NotificationOptions) => show('warning', title, options),
  error: (title: string, options?: NotificationOptions) => show('error', title, options),
  saving: () => {
    const toasterId = [...dialogScopes].at(-1);
    let id: ReturnType<typeof toast.loading> | undefined;
    const timer = window.setTimeout(() => {
      if (toasterId && !dialogScopes.has(toasterId)) return;
      id = toast.loading('Salvando…', { toasterId, dismissible: false, duration: Infinity });
    }, 200);

    return () => {
      window.clearTimeout(timer);
      if (id !== undefined) toast.dismiss(id);
    };
  },
};
