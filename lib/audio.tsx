// Theme-aware music. Café Crème plays theme-song.mp3; Minuit plays
// clair-de-lune.mp3. Switching themes switches the song; the sound
// toggle persists across restarts.
import { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAudioPlayer } from 'expo-audio';
import { useTheme } from './theme-context';

const SONGS = {
  creme: require('../assets/audio/theme-song.mp3'),
  minuit: require('../assets/audio/clair-de-lune.mp3'),
};

type SoundState = { soundOn: boolean; toggle: () => void };
const SoundContext = createContext<SoundState>({ soundOn: true, toggle: () => {} });

export function AudioProvider({ children }: { children: React.ReactNode }) {
  const { mode } = useTheme();
  const player = useAudioPlayer(SONGS.creme);
  const [soundOn, setSoundOn] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('soundOn').then((saved) => {
      setSoundOn(saved !== 'off');
      setReady(true);
    });
  }, []);

  // Theme changed: swap the record on the turntable.
  useEffect(() => {
    if (!ready) return;
    player.replace(SONGS[mode]);
    player.loop = true;
    player.volume = 0.6;
    if (soundOn) player.play();
  }, [mode, ready]);

  useEffect(() => {
    if (!ready) return;
    player.loop = true;
    player.volume = 0.6;
    if (soundOn) {
      player.play();
    } else {
      player.pause();
    }
  }, [ready, soundOn]);

  const toggle = () => {
    setSoundOn((current) => {
      AsyncStorage.setItem('soundOn', current ? 'off' : 'on');
      return !current;
    });
  };

  return (
    <SoundContext.Provider value={{ soundOn, toggle }}>
      {children}
    </SoundContext.Provider>
  );
}

export const useSound = () => useContext(SoundContext);
