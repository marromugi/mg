import { drawFace } from "../face.js";

// The face drawn for a seed, as an image address. The same seed always
// gives the same face.
export const useAvatarImage = (seed: string): string =>
  `data:image/svg+xml;utf8,${encodeURIComponent(drawFace(seed))}`;
