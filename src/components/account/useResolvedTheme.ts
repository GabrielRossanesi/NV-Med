'use client';

import { useSyncExternalStore } from 'react';
import { useStore } from '@/store/useStore';

const query = '(prefers-color-scheme: dark)';
function subscribe(callback: () => void) {
  const preference = window.matchMedia(query);
  preference.addEventListener('change', callback);
  return () => preference.removeEventListener('change', callback);
}
const systemTheme = () => window.matchMedia(query).matches ? 'dark' : 'light';
const serverTheme = () => 'light';

export function useResolvedTheme() {
  const theme = useStore(state => state.theme);
  const system = useSyncExternalStore(subscribe, systemTheme, serverTheme);
  return theme === 'system' ? system : theme;
}
