import { useEffect, useRef } from "react";
import { tv } from "tailwind-variants";
import { useOrbLook } from "./hooks/useOrbLook.js";
import { startOrb } from "./stage.js";

const orb = tv({
  base: "block shrink-0 rounded-full bg-scrim",
  variants: {
    size: { sm: "size-8", md: "size-10", lg: "size-16", xl: "size-40" },
  },
  defaultVariants: { size: "md" },
});

type OrbProps = {
  // What the orb is drawn from; the same seed gives the same orb.
  seed: string;
  size?: "sm" | "md" | "lg" | "xl";
  // Read out in place of the orb. Left out when a name sits beside it.
  label?: string;
};

// A dark ball with a ring of light and two eyes, drawn from its seed.
// The ring drifts, the eyes follow the pointer and blink, and the orb
// hops now and then and when pressed, unless the device asks for less
// motion.
export const Orb = ({ seed, size, label }: OrbProps) => {
  const canvas = useRef<HTMLCanvasElement>(null);
  const look = useOrbLook(seed);
  const { hue, turn, eyeWidth, eyeHeight, eyeGap } = look;

  useEffect(() => {
    if (canvas.current === null) return;
    const still = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    return startOrb(
      canvas.current,
      { hue, turn, eyeWidth, eyeHeight, eyeGap },
      still ? "still" : "moving",
    );
  }, [hue, turn, eyeWidth, eyeHeight, eyeGap]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      className={orb({ size })}
    />
  );
};
