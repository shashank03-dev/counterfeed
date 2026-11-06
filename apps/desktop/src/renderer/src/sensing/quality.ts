import type { Quality } from './types';

// SmartSpectra ValidationCode values (docs/nodejs/api-reference.md, ValidationCode).
export const V = {
  ok: 0,
  noFace: 1,
  multipleFaces: 2,
  notCentered: 3,
  faceSizeOutOfRange: 4, // deprecated, superseded by tooClose/tooFar
  tooDark: 5,
  tooBright: 6,
  chestNotVisible: 7,
  cameraTuning: 10,
  frameRateTooLow: 11,
  excessiveMotion: 12,
  tooClose: 13,
  tooFar: 14,
  tooHigh: 15,
  tooLow: 16,
  notForward: 17,
} as const;

const LIGHT = new Set<number>([V.tooDark, V.tooBright, V.frameRateTooLow]);
const STILL = new Set<number>([V.excessiveMotion]);
const FRAMING = new Set<number>([V.noFace, V.multipleFaces, V.notCentered, V.faceSizeOutOfRange, V.chestNotVisible, V.tooClose, V.tooFar, V.tooHigh, V.tooLow, V.notForward]);

/** Plain-language fallback when the SDK sends no hint text. */
const FALLBACK: Record<number, string> = {
  [V.noFace]: 'Move into the frame, facing the camera.',
  [V.multipleFaces]: 'Only one person in view, please.',
  [V.notCentered]: 'Center yourself in the frame.',
  [V.faceSizeOutOfRange]: 'Adjust your distance to the camera.',
  [V.tooDark]: 'A little more light on your face.',
  [V.tooBright]: 'Too bright: move away from strong light behind you.',
  [V.chestNotVisible]: 'Sit back so your upper chest is in view.',
  [V.cameraTuning]: 'The camera is adjusting. One moment.',
  [V.frameRateTooLow]: 'More light helps the camera keep up.',
  [V.excessiveMotion]: 'Try to stay still.',
  [V.tooClose]: 'Move back a little.',
  [V.tooFar]: 'Move a little closer.',
  [V.tooHigh]: 'Move down a little.',
  [V.tooLow]: 'Move up a little.',
  [V.notForward]: 'Face the camera.',
};

/**
 * One SDK validation code -> the Lobby checklist. The SDK reports one code at a time, so a non-OK code
 * marks its own row and leaves the others as they were; OK clears every row.
 */
export function applyValidation(prev: Quality | null, code: number, hint: string): Quality {
  const base: Quality = prev ?? { code, hint: '', light: 'unknown', framing: 'unknown', stillness: 'unknown', settling: false };
  const text = hint?.trim() || FALLBACK[code] || '';
  if (code === V.ok) return { code, hint: '', light: 'ok', framing: 'ok', stillness: 'ok', settling: false };
  return {
    code,
    hint: text,
    light: LIGHT.has(code) ? 'warn' : base.light,
    framing: FRAMING.has(code) ? 'warn' : base.framing,
    stillness: STILL.has(code) ? 'warn' : base.stillness,
    settling: code === V.cameraTuning,
  };
}
