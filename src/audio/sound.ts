import type { PlayedMove } from '../lib/chess';
import { useSettings } from '../state/settings';

/*
 * Every sound is synthesised: a short band-passed noise burst (the "click" of a piece on
 * wood) over a low sine thump. No audio files, so nothing to license or download.
 */

let ctx: AudioContext | undefined;

function audio(): AudioContext | undefined {
  const { sound } = useSettings.getState();
  if (!sound || typeof AudioContext === 'undefined') return undefined;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

interface Knock {
  at?: number;
  freq?: number;
  decay?: number;
  gain?: number;
  thump?: number;
}

function knock({ at = 0, freq = 1900, decay = 0.045, gain = 0.5, thump = 180 }: Knock = {}): void {
  const c = audio();
  if (!c) return;
  const volume = useSettings.getState().volume;
  const t = c.currentTime + at;
  const length = Math.floor(c.sampleRate * (decay + 0.02));
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  const noise = c.createBufferSource();
  noise.buffer = buffer;
  const band = c.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 2.5;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(gain * volume, t);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  noise.connect(band).connect(noiseGain).connect(c.destination);
  noise.start(t);

  const osc = c.createOscillator();
  osc.frequency.setValueAtTime(thump, t);
  osc.frequency.exponentialRampToValueAtTime(thump * 0.55, t + 0.07);
  const oscGain = c.createGain();
  oscGain.gain.setValueAtTime(0.4 * gain * volume, t);
  oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(oscGain).connect(c.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

function tone(freq: number, at: number, length: number, gain = 0.12): void {
  const c = audio();
  if (!c) return;
  const volume = useSettings.getState().volume;
  const t = c.currentTime + at;
  const osc = c.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain * volume, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + length);
  osc.connect(g).connect(c.destination);
  osc.start(t);
  osc.stop(t + length + 0.02);
}

export const sound = {
  move: () => knock(),
  capture: () => {
    knock({ freq: 1300, decay: 0.07, gain: 0.75, thump: 140 });
    knock({ at: 0.04, freq: 2300, decay: 0.035, gain: 0.3 });
  },
  castle: () => {
    knock();
    knock({ at: 0.1, freq: 1600, gain: 0.45 });
  },
  check: () => {
    knock({ freq: 2500, gain: 0.55 });
    tone(1175, 0.02, 0.16, 0.08);
  },
  gameEnd: () => [523, 659, 784].forEach((f, i) => tone(f, 0.08 + i * 0.11, 0.35)),
  success: () => [659, 880].forEach((f, i) => tone(f, i * 0.09, 0.25)),
  failure: () => [392, 311].forEach((f, i) => tone(f, i * 0.12, 0.3, 0.1)),
  lowTime: () => tone(988, 0, 0.12, 0.1),
};

export function playMoveSound(m: PlayedMove): void {
  if (m.isCheck && !m.isCheckmate) sound.check();
  else if (m.isCastle) sound.castle();
  else if (m.captured) sound.capture();
  else sound.move();
  if (m.isCheckmate) sound.gameEnd();
}

const SPOKEN_PIECES: Record<string, string> = {
  K: 'King',
  Q: 'Queen',
  R: 'Rook',
  B: 'Bishop',
  N: 'Knight',
};

/** "Nxe5+" → "Knight takes e5, check". */
export function sanToSpeech(san: string): string {
  if (san.startsWith('O-O-O'))
    return `castles queenside${san.includes('#') ? ', checkmate' : san.includes('+') ? ', check' : ''}`;
  if (san.startsWith('O-O'))
    return `castles kingside${san.includes('#') ? ', checkmate' : san.includes('+') ? ', check' : ''}`;
  const m = /^([KQRBN])?([a-h]?[1-8]?)(x)?([a-h][1-8])(?:=([QRBN]))?([+#])?/.exec(san);
  if (!m) return san;
  const [, piece, from, capture, to, promo, suffix] = m;
  const parts = [piece ? SPOKEN_PIECES[piece] : from || '', capture ? 'takes' : '', to];
  if (piece && from) parts.splice(1, 0, from);
  if (promo) parts.push(`promotes to ${SPOKEN_PIECES[promo]}`);
  const text = parts.filter(Boolean).join(' ');
  return suffix === '#' ? `${text}, checkmate` : suffix === '+' ? `${text}, check` : text;
}

export function speak(text: string): void {
  if (!useSettings.getState().voice || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}
