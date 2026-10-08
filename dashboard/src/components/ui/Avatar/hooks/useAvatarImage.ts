import { humation1 } from "@humation/assets-humation-1";
import { createAvatar } from "@humation/core";

// The face drawn for a seed, as an image address. The same seed always
// gives the same face.
export const useAvatarImage = (seed: string): string =>
  createAvatar(humation1, { seed }).toDataUri();
