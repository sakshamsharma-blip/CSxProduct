import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';

/**
 * Display mode for Flow.
 *  - light / dark: fixed choice
 *  - system: follows the operating system setting and updates live when it changes
 *
 * The choice is saved per browser in localStorage. index.html applies the saved
 * choice before React loads so the page never flashes the wrong theme.
 */
export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'flow-theme';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function readStoredMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* storage blocked (private window etc.) — fall back to system */
  }
  return 'system';
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(DARK_QUERY).matches;
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  // Makes native controls (scrollbars, date pickers, selects) match the theme.
  root.style.colorScheme = resolved;
}

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark);

  // Track the OS setting so "System" updates live.
  useEffect(() => {
    const mql = window.matchMedia?.(DARK_QUERY);
    if (!mql) return;
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Keep tabs in sync when the choice is changed in another tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY) setModeState(readStoredMode());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const resolved: ResolvedTheme = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* ignore — the choice just won't persist */
    }
  }, []);

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
