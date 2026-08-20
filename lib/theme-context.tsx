// Theme switching — Café Crème by day, Minuit by night.
// The chosen mode persists across restarts; the audio provider listens
// to it to swap soundtracks.
import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { palettes, Palette } from './theme';

type Mode = 'creme' | 'minuit';

type ThemeState = {
  mode: Mode;
  c: Palette;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeState>({
  mode: 'creme',
  c: palettes.creme,
  toggleTheme: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('creme');

  useEffect(() => {
    AsyncStorage.getItem('themeMode').then((saved) => {
      if (saved === 'minuit') setMode('minuit');
    });
  }, []);

  const toggleTheme = () => {
    setMode((current) => {
      const next = current === 'creme' ? 'minuit' : 'creme';
      AsyncStorage.setItem('themeMode', next);
      return next;
    });
  };

  return (
    <ThemeContext.Provider value={{ mode, c: palettes[mode], toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
