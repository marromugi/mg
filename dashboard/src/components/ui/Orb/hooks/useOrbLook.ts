// How one orb looks: the colour and turn of its ring, and its eyes.
// Lengths are fractions of the orb's radius.
export type OrbLook = {
  // Where the ring's colours sit on the colour wheel, from 0 to 1.
  hue: number;
  // Where the ring's flare points, in radians.
  turn: number;
  eyeWidth: number;
  eyeHeight: number;
  // From the middle of the face to the middle of one eye.
  eyeGap: number;
};

const EYES: readonly Pick<OrbLook, "eyeWidth" | "eyeHeight">[] = [
  { eyeWidth: 0.17, eyeHeight: 0.2 },
  { eyeWidth: 0.19, eyeHeight: 0.19 },
  { eyeWidth: 0.15, eyeHeight: 0.22 },
  { eyeWidth: 0.2, eyeHeight: 0.17 },
  { eyeWidth: 0.16, eyeHeight: 0.17 },
];

const hash = (text: string): number => {
  let value = 2166136261;
  for (const letter of text) {
    value ^= letter.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
};

// Numbers from 0 up to 1 that follow from `seed` alone.
const sequence = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let mixed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  mixed =
    (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
};

// The look drawn for a seed. The same seed always gives the same look.
export const useOrbLook = (seed: string): OrbLook => {
  const next = sequence(hash(seed));
  const hue = next();
  const turn = next() * Math.PI * 2;
  const eyes = EYES[Math.floor(next() * EYES.length)] ?? EYES[0];
  const eyeGap = eyes.eyeWidth + 0.06 + next() * 0.04;
  return { hue, turn, eyeGap, ...eyes };
};
