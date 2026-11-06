/**
 * Room codes look like `TIDE-42`: a short, calm, easy-to-say word and two digits.
 * 48 words x 100 numbers = 4,800 live codes. Guessing is throttled server side
 * (joins are rate limited per IP) and a room holds at most two people.
 */
export const ROOM_WORDS = [
  'TIDE', 'MOSS', 'FERN', 'DUNE', 'REEF', 'PINE', 'SAGE', 'LARK',
  'WREN', 'OPAL', 'JADE', 'MIST', 'RAIN', 'SNOW', 'LAKE', 'COVE',
  'BAY', 'GLEN', 'VALE', 'HILL', 'PEAK', 'STAR', 'MOON', 'SUN',
  'DAWN', 'DUSK', 'LEAF', 'ROOT', 'SEED', 'BLOOM', 'PETAL', 'RIVER',
  'BROOK', 'CLOUD', 'EMBER', 'FLAME', 'STONE', 'PEARL', 'CORAL', 'OLIVE',
  'MAPLE', 'CEDAR', 'BIRCH', 'ASPEN', 'LOTUS', 'IRIS', 'ORCA', 'OWL',
] as const;

export const ROOM_CODE_RE = /^[A-Z]{3,5}-\d{2}$/;

/** Normalise what a person typed ("tide 42", "Tide-42 ") to `TIDE-42`, or null if it can't be a code. */
export function normalizeRoomCode(input: string): string | null {
  const m = /^\s*([a-zA-Z]{3,5})[\s\-_]*(\d{2})\s*$/.exec(input);
  if (!m) return null;
  const code = `${m[1]!.toUpperCase()}-${m[2]}`;
  return (ROOM_WORDS as readonly string[]).includes(m[1]!.toUpperCase()) ? code : null;
}

export function makeRoomCode(random: () => number = Math.random): string {
  const word = ROOM_WORDS[Math.floor(random() * ROOM_WORDS.length)]!;
  const n = Math.floor(random() * 100);
  return `${word}-${String(n).padStart(2, '0')}`;
}

/** Self-reported mood words. Neutral, plain, and never inferred from the camera. */
export const MOOD_WORDS = ['Calm', 'Steady', 'Content', 'Tired', 'Restless', 'Tense', 'Scattered', 'Heavy', 'Light'] as const;
export type MoodWord = (typeof MOOD_WORDS)[number];
