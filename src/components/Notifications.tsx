'use client';

import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { Toaster } from 'sonner';
import { visibleNotifications } from '@/lib/notifications';

const icons = {
  success: <CircleCheck size={18} aria-hidden="true" />,
  info: <Info size={18} aria-hidden="true" />,
  warning: <TriangleAlert size={18} aria-hidden="true" />,
  error: <CircleAlert size={18} aria-hidden="true" />,
  close: <X size={16} aria-hidden="true" />,
};

export default function Notifications({ id }: { id?: string }) {
  return (
    <Toaster
      id={id}
      className="nv-toaster"
      position="top-right"
      offset={{ top: 20, right: 20 }}
      mobileOffset={{
        top: 'calc(12px + env(safe-area-inset-top))',
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
