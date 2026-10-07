// Draws the face for a seed as an SVG document: the head of a dog or a
// cat seen from the side, in a thick ink line on flat colour. The line
// of each animal never changes; the seed picks the animal, its ears
// and how they are filled, its eye, what marks it, the colours, and
// which way it looks. The same seed always draws the same face.
//
// The parts are drawn in the units of the lines themselves, 199 wide,
// and placed in the frame as one.

const INK = "oklch(22% 0.02 60)";
const CREAM = "oklch(94% 0.035 90)";
const MUSTARD = "oklch(79% 0.145 86)";
const ORANGE = "oklch(68% 0.17 52)";
const TOMATO = "oklch(60% 0.19 30)";
const TEAL = "oklch(60% 0.09 200)";
const OLIVE = "oklch(64% 0.11 118)";
const NAVY = "oklch(36% 0.075 255)";
const PINK = "oklch(80% 0.075 18)";

// The paper behind, and the colours that stand out in front of it.
const SCENES: readonly (readonly [
  paper: string,
  colours: readonly string[],
])[] = [
  [CREAM, [TOMATO, TEAL, MUSTARD, NAVY, ORANGE]],
  [MUSTARD, [TOMATO, TEAL, NAVY, CREAM]],
  [ORANGE, [NAVY, CREAM, MUSTARD, TEAL]],
  [TEAL, [MUSTARD, CREAM, TOMATO, ORANGE]],
  [OLIVE, [CREAM, MUSTARD, TOMATO, NAVY]],
  [PINK, [TOMATO, NAVY, TEAL, MUSTARD]],
  [TOMATO, [CREAM, MUSTARD, NAVY]],
];

const SCALE = 0.27;
const LINE = 8;

type Point = readonly [x: number, y: number];

type Animal = {
  // The one line of the head: from the chin, around the nose, over the
  // head, and down the back of the neck.
  line: string;
  // What closes the line into the shape that is filled, and the line
  // down the front of the neck.
  body: string;
  neck: string;
  nose: readonly [x: number, y: number, size: number];
  eye: Point;
  // Where the head sits in the frame.
  place: string;
  ears: readonly string[];
  whiskers: string;
  collar: readonly [band: string, tag: Point];
  specks: readonly Point[];
  stripes: string;
};

const DROP_EAR =
  "M164.174 56.898C159.21 53.661 153.777 50.953 148.027 49.985C142.276 49.017 136.688 49.864 132.04 52.604C127.393 55.343 123.947 59.823 122.01 65.324C120.073 70.824 119.812 76.888 120.24 82.799C120.353 84.237 120.502 85.654 120.689 87.049C121.877 95.927 124.566 103.919 128.757 111.027C136.416 124.019 150.041 133.495 169.632 139.453C171.316 139.965 173.044 140.451 174.816 140.911C176.631 141.365 178.395 141.786 180.011 141.911C181.635 142.032 183.04 141.809 184.221 141.113C185.402 140.416 186.278 139.295 186.958 137.816C187.631 136.341 188.116 134.594 188.599 132.785C189.054 131.012 189.465 129.265 189.832 127.544C194.104 107.517 192.41 91.008 184.75 78.016C180.56 70.908 174.868 64.686 167.675 59.348C166.545 58.509 165.378 57.693 164.174 56.898Z";

const DOG: Animal = {
  line: "M83.706 150.848C53.708 180.067-9.357 67.75 31.206 57.348C51.76 52.077 63.96 79.116 83.706 71.348C96.684 66.243 95.885 50.476 109.206 46.348C133.238 38.902 148.747 63.702 159.706 86.348C170.68 109.021 159.706 150.848 159.706 150.848",
  body: "L160 320L84 320Z",
  neck: "M83.7 150.8C86 172 84 210 84 320",
  nose: [34.2, 66.8, 11],
  eye: [101.7, 88.3],
  place: "translate(4.2 7)",
  ears: [
    `<path d="${DROP_EAR}"/>`,
    `<path d="${DROP_EAR}"/>`,
    `<path d="M148 50c22 6 38 42 34 96-1 12-10 18-19 14-21-10-37-50-41-84-2-16 10-30 26-26z"/>`,
    `<path d="M112 50c-4-18 0-36 10-46 3-3 8-2 10 2 10 16 16 36 18 58z"/>`,
    `<path d="M117 47c14-5 29 5 32 20-8 9-20 11-29 6-7-8-8-18-3-26z"/>`,
  ],
  whiskers: ``,
  collar: ["M83 146q39 16 77-2", [120, 167]],
  specks: [
    [92, 114],
    [106, 121],
    [89, 127],
  ],
  stripes: ``,
};

const CAT_EARS = `<path d="M118 54c6-16 16-28 28-34 4-2 8 1 7 5-1 15-3 27-7 39z"/><path d="M90 58c-2-18 2-36 11-48 3-4 8-3 10 1 9 13 15 27 17 43z"/>`;

const CAT: Animal = {
  line: "M100 158C96 148 90 140 80 136C68 132 56 128 52 118C49 112 49 106 53 102C56 99 60 96 62 91C66 78 76 64 92 56C110 47 132 50 146 64C156 74 160 88 160 102C161 122 160 156 160 156",
  body: "L160 320L100 320Z",
  neck: "M100 158V320",
  nose: [52.5, 106.5, 6],
  eye: [88, 97],
  place: "translate(7.4 9.5)",
  ears: [
    CAT_EARS,
    CAT_EARS,
    `<path d="M122 53c10-13 23-21 37-23 4 0 7 4 5 8-5 12-11 22-19 30z"/><path d="M88 60c-8-16-11-33-8-47 1-5 6-6 9-3 14 11 25 25 33 42z"/>`,
    `${CAT_EARS}<path d="M104 9l-3-12M150 21l5-11" fill="none"/>`,
  ],
  whiskers: `<path d="M61 113L24 103M61 118L21 119M62 123L27 134" stroke-width="${LINE * 0.42}"/>`,
  collar: ["M96 151q32 14 64-3", [127, 170]],
  specks: [
    [66, 110],
    [72, 118],
    [66, 126],
  ],
  stripes: "M145 64l-11 8M155 80l-13 5M160 98l-14 1",
};

// How an ear is filled: with ink, with printed dots on cream, or with
// the scene's colour. The ink line goes around all of it.
const FILLS: readonly ((ear: string, colour: string) => string)[] = [
  (ear) =>
    `<g fill="${INK}" stroke="${INK}" stroke-width="${LINE / 2}">${ear}</g>`,
  (ear) =>
    `<g fill="${CREAM}" stroke="${INK}" stroke-width="${LINE}">${ear}</g><g fill="url(#dots)" stroke="none">${ear}</g>`,
  (ear, colour) =>
    `<g fill="${colour}" stroke="${INK}" stroke-width="${LINE}">${ear}</g>`,
  (ear, colour) =>
    `<g fill="${colour}" stroke="${INK}" stroke-width="${LINE}">${ear}</g>`,
  (ear, colour) =>
    `<g fill="${colour}" stroke="${INK}" stroke-width="${LINE}">${ear}</g>`,
];

const EYES: readonly ((at: Point) => string)[] = [
  ([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="5.500" fill="${INK}" stroke="none"/>`,
  ([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="5.500" fill="${INK}" stroke="none"/>`,
  ([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="4" fill="${INK}" stroke="none"/>`,
  ([x, y]) =>
    `<path d="M${x - 8} ${y + 2}q8-10 16 0" stroke-width="${LINE * 0.75}"/>`,
  ([x, y]) =>
    `<path d="M${x - 8} ${y}h16" stroke-width="${LINE * 0.75}"/>`,
];

// What marks the animal: a printed patch around the eye, a collar with
// a tag in `colour`, specks on the cheek, or stripes on the head.
const MARKS: readonly ((animal: Animal, colour: string) => string)[] = [
  () => ``,
  () => ``,
  (animal) =>
    `<circle cx="${animal.eye[0]}" cy="${animal.eye[1]}" r="20" fill="url(#dots)" stroke="none"/>`,
  (animal, colour) =>
    `<path d="${animal.collar[0]}" stroke-width="${LINE + 3}"/><circle cx="${animal.collar[1][0]}" cy="${animal.collar[1][1]}" r="7" fill="${colour}" stroke-width="${LINE * 0.6}"/>`,
  (animal, colour) =>
    `<path d="${animal.collar[0]}" stroke-width="${LINE + 3}"/><circle cx="${animal.collar[1][0]}" cy="${animal.collar[1][1]}" r="7" fill="${colour}" stroke-width="${LINE * 0.6}"/>`,
  (animal) =>
    `<g fill="${INK}" stroke="none">${animal.specks.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.200"/>`).join("")}</g>`,
  (animal) =>
    `<path d="${animal.stripes}" stroke-width="${LINE * 0.7}"/>`,
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

export const drawFace = (seed: string): string => {
  const next = sequence(hash(seed));
  const pick = <Part>(parts: readonly Part[]): Part =>
    parts[Math.floor(next() * parts.length)];

  const [paper, colours] = pick(SCENES);
  const earColour = pick(colours);
  const markColour = pick(colours);
  const animal = next() < 0.5 ? DOG : CAT;
  const ear = pick(animal.ears);
  const fill = pick(FILLS);
  const eye = pick(EYES);
  const mark = pick(MARKS);
  const turned = next() < 0.5 ? -1 : 1;
  const [noseX, noseY, noseSize] = animal.nose;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>
<clipPath id="frame"><circle cx="32" cy="32" r="32"/></clipPath>
<pattern id="dots" width="6.500" height="6.500" patternUnits="userSpaceOnUse" patternTransform="rotate(32)"><circle cx="3.250" cy="3.250" r="1.350" fill="${INK}"/></pattern>
</defs>
<g clip-path="url(#frame)">
<rect width="64" height="64" fill="${paper}"/>
<g transform="translate(32 0) scale(${turned} 1) translate(-32 0)">
<g transform="${animal.place} scale(${SCALE})" fill="none" stroke="${INK}" stroke-width="${LINE}" stroke-linecap="round" stroke-linejoin="round">
<path d="${animal.line}${animal.body}" fill="${CREAM}" stroke="none"/>
${mark(animal, markColour)}
<path d="${animal.line}"/><path d="${animal.neck}"/>
${animal.whiskers}
<circle cx="${noseX}" cy="${noseY}" r="${noseSize}" fill="${INK}" stroke="none"/>
${eye(animal.eye)}
${fill(ear, earColour)}
</g></g></g></svg>`;
};
