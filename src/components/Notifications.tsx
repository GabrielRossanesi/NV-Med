'use client';

import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { Toaster } from 'sonner';
import { visibleNotifications } from '@/lib/notifications';

const icons = {
  success: <CircleCheck size={18} aria-hidden="true" />,
  info: <Info size={18} aria-hidden="true" />,
  warning: <TriangleAlert size={18} aria-hidden="true" />,
  error: <CircleAlert size={18} aria-hidden="true" />,
  loading: <LoaderCircle size={18} className="motion-safe:animate-spin" aria-hidden="true" />,
  close: <X size={16} aria-hidden="true" />,
};

export default function Notifications({ id }: { id?: string }) {
  return (
    <Toaster
      id={id}
      className="nv-toaster"
      position="bottom-right"
      offset={{ bottom: 'calc(20px + var(--nv-toast-keyboard-offset, 0px) + var(--nv-toast-navigation-offset, 0px))', right: 20 }}
      mobileOffset={{
        bottom: 'calc(12px + env(safe-area-inset-bottom) + var(--nv-toast-keyboard-offset, 0px) + var(--nv-toast-navigation-offset, 0px))',
        right: 'max(12px, env(safe-area-inset-right))',
        left: 'max(12px, env(safe-area-inset-left))',
      }}
      visibleToasts={visibleNotifications}
      gap={8}
      closeButton
      icons={icons}
      containerAriaLabel="Notificações da sessão"
      toastOptions={{ unstyled: true, closeButtonAriaLabel: 'Dispensar notificação' }}
    />
  );
}
