/* App-wide sound preference.
 *
 * The sound setting used to live as local `useState` inside `AnalysisBoard`
 * (the Play Arena). That made it page-scoped: it reset to "on" on every
 * navigation, and no other board could read or change it — which is why the
 * chess.com move sounds only worked on the one page that happened to own the
 * state, and why Settings had no sound controls at all.
 *
 * This provider lifts that preference to the whole app. It is a thin React
 * wrapper over `utils/sound.js`, which remains the single source of truth (it
 * owns the AudioContext, the samples, the volume multiplier and localStorage
 * persistence). Components subscribe to the module and re-render when it
 * changes, so every board, modal and page sees the same value.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import {
  getSoundVolume,
  isSoundEnabled,
  playSound,
  setSoundEnabled,
  setSoundVolume,
  subscribeSoundEnabled,
  subscribeSoundVolume,
  unlockAudio,
} from '../utils/sound.js';

const SoundContext = createContext(null);

/* Used when a component renders outside the provider (e.g. a test harness that
 * mounts a board in isolation). It delegates to the same module, so behaviour
 * matches — it just doesn't re-render on change. */
const FALLBACK = {
  soundOn: isSoundEnabled(),
  setSoundOn: setSoundEnabled,
  volume: getSoundVolume(),
  setVolume: setSoundVolume,
  playSound,
  unlockAudio,
};

export function SoundProvider({ children }) {
  const [soundOn, setSoundOnState] = useState(isSoundEnabled);
  const [volume, setVolumeState] = useState(getSoundVolume);

  /* Mirror the module into React state so every consumer re-renders together. */
  useEffect(() => subscribeSoundEnabled(setSoundOnState), []);
  useEffect(() => subscribeSoundVolume(setVolumeState), []);

  const setSoundOn = useCallback((v) => {
    /* Browsers only allow resume() from a real user gesture, and the next
     * interaction is the first moment we get one. Unlocking here means turning
     * sound on takes effect on the very next move rather than after another
     * click somewhere else. */
    if (v) unlockAudio();
    setSoundEnabled(v);
  }, []);

  const setVolume = useCallback((v) => setSoundVolume(v), []);

  return (
    <SoundContext.Provider value={{ soundOn, setSoundOn, volume, setVolume, playSound, unlockAudio }}>
      {children}
    </SoundContext.Provider>
  );
}

/**
 * Read the shared sound preference.
 * @returns {{ soundOn: boolean, setSoundOn: (v: boolean) => void,
 *             volume: number, setVolume: (v: number) => void,
 *             playSound: (kind: string) => void, unlockAudio: () => void }}
 */
export function useSound() {
  return useContext(SoundContext) || FALLBACK;
}

export default SoundProvider;
