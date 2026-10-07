import { tv } from "tailwind-variants";
import { useAvatarImage } from "./hooks/useAvatarImage.js";

const avatar = tv({
  base: "shrink-0 rounded-full bg-surface",
  variants: {
    size: { sm: "size-8", md: "size-10", lg: "size-16" },
  },
  defaultVariants: { size: "md" },
});

type AvatarProps = {
  // What the face is drawn from; the same seed gives the same face.
  seed: string;
  size?: "sm" | "md" | "lg";
  // Read out in place of the face. Left out when a name sits beside it.
  label?: string;
};

// A round face that stands for one thing, drawn from its seed.
export const Avatar = ({ seed, size, label = "" }: AvatarProps) => (
  <img
    src={useAvatarImage(seed)}
    alt={label}
    className={avatar({ size })}
  />
);
