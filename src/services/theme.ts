/**
 * Clawpilot-inspired theme colors for the mobile app.
 * Supports light and dark mode via the useColors() hook.
 * A ThemeProvider lets the user override the system scheme
 * (System / Light / Dark), persisted to AsyncStorage.
 */
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Palette = {
  bg: string;
  bgElevated: string;
  surface: string;
  surfaceSoft: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSoft: string;
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentFg: string;
  success: string;
  danger: string;
  warning: string;
  link: string;
};

export const colors: Palette = {
  bg: '#f7f4ef',
  bgElevated: '#fcfbf8',
  surface: '#ffffff',
  surfaceSoft: '#f5f5f5',
  border: '#dedede',
  borderStrong: '#919191',
  text: '#242424',
  textMuted: '#5c5c5c',
  textSoft: '#6f6f6f',
  accent: '#b11f4b',
  accentHover: '#9a1a41',
  accentSoft: 'rgba(177, 31, 75, 0.08)',
  accentFg: '#ffffff',
  success: '#16a34a',
  danger: '#dc2626',
  warning: '#f59e0b',
  link: '#0078d4',
};

export const darkColors: Palette = {
  bg: '#3d3b3a',
  bgElevated: '#343231',
  surface: '#292929',
  surfaceSoft: '#2e2e2e',
  border: '#474747',
  borderStrong: '#5f5f5f',
  text: '#dedede',
  textMuted: '#919191',
  textSoft: '#b0b0b0',
  accent: '#fd8ea1',
  accentHover: '#fb7b91',
  accentSoft: 'rgba(253, 142, 161, 0.14)',
  accentFg: '#1a1a1a',
  success: '#4ade80',
  danger: '#f87171',
  warning: '#fbbf24',
  link: '#4da6ff',
};

export type ThemeMode = 'system' | 'light' | 'dark';

const THEME_PREF_KEY = '@agent_supervisor_theme_pref';

type ThemeContextValue = {
  colors: Palette;
  scheme: 'light' | 'dark';
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Provider that resolves the active palette from the user's saved preference
 * (System / Light / Dark) and the device color scheme. Wrap the app in this.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('dark');

  useEffect(() => {
    AsyncStorage.getItem(THEME_PREF_KEY).then((v) => {
      if (v === 'system' || v === 'light' || v === 'dark') setModeState(v);
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    AsyncStorage.setItem(THEME_PREF_KEY, m).catch(() => {});
  }, []);

  const scheme: 'light' | 'dark' =
    mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const palette = scheme === 'dark' ? darkColors : colors;

  return React.createElement(
    ThemeContext.Provider,
    { value: { colors: palette, scheme, mode, setMode } },
    children
  );
}

/**
 * Hook that returns the active palette. Falls back to the system scheme
 * when used outside a ThemeProvider.
 */
export function useColors(): Palette {
  const ctx = useContext(ThemeContext);
  const scheme = useColorScheme();
  if (ctx) return ctx.colors;
  return scheme === 'dark' ? darkColors : colors;
}

/**
 * Hook to read and change the theme preference and resolved scheme.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  const scheme = useColorScheme();
  if (ctx) return ctx;
  const resolved: 'light' | 'dark' = scheme === 'dark' ? 'dark' : 'light';
  return {
    colors: resolved === 'dark' ? darkColors : colors,
    scheme: resolved,
    mode: 'system',
    setMode: () => {},
  };
}
