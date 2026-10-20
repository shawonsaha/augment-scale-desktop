/**
 * Tactical Web Audio feedback for operator actions
 * Lightweight synthesizer with zero external sound assets.
 */
export const getAudioContext = () => {
  if (typeof window === 'undefined') return null;
  if (!window._audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    window._audioCtx = new AudioCtx();
  }
  if (window._audioCtx && window._audioCtx.state === 'suspended') {
    window._audioCtx.resume();
  }
  return window._audioCtx;
};

export const playTone = (freq, duration, type = 'sine', gainVal = 0.08) => {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(gainVal, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
};

export const hapticAudio = {
  playClick: () => playTone(600, 0.04),
  playCapture: () => playTone(800, 0.08, 'triangle', 0.12),
  playSuccess: () => {
    playTone(587.33, 0.08, 'sine', 0.1);
    setTimeout(() => playTone(880, 0.14, 'sine', 0.1), 80);
  },
  playError: () => playTone(200, 0.15, 'sawtooth', 0.08),
};

if (typeof window !== 'undefined') {
  window.hapticAudio = hapticAudio;
}

export default hapticAudio;
