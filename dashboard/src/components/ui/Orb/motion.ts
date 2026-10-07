// The timing of the orb's moves. Each follows the same order: a small
// move the other way first, the move itself, then a settle past the
// end and back.

export type Spring = { at: number; speed: number };

// Moves `spring` toward `target` over `seconds`. It is loose enough to
// pass the target a little and come back.
export const stepSpring = (
  spring: Spring,
  target: number,
  seconds: number,
  stiffness: number,
  damping: number,
): Spring => {
  const pull =
    (target - spring.at) * stiffness - spring.speed * damping;
  const speed = spring.speed + pull * seconds;
  return { at: spring.at + speed * seconds, speed };
};

const WIDEN_END = 0.11;
const SHUT_END = 0.18;
const HOLD_END = 0.23;
const OPEN_END = 0.4;
export const BLINK_SECONDS = 0.56;

const WIDE = 1.14;
const SHUT = 0.04;
const PAST = 1.1;

const eased = (from: number, to: number, part: number): number =>
  from + (to - from) * part * part * (3 - 2 * part);

// How open the eyes are, `seconds` into a blink; 1 is the resting
// height. They widen first, shut fast, then open past the rest and
// settle.
export const blinkOpen = (seconds: number): number => {
  if (seconds <= 0 || seconds >= BLINK_SECONDS) return 1;
  if (seconds < WIDEN_END) return eased(1, WIDE, seconds / WIDEN_END);
  if (seconds < SHUT_END) {
    const part = (seconds - WIDEN_END) / (SHUT_END - WIDEN_END);
    return WIDE + (SHUT - WIDE) * part * part;
  }
  if (seconds < HOLD_END) return SHUT;
  if (seconds < OPEN_END) {
    return eased(
      SHUT,
      PAST,
      (seconds - HOLD_END) / (OPEN_END - HOLD_END),
    );
  }
  return eased(
    PAST,
    1,
    (seconds - OPEN_END) / (BLINK_SECONDS - OPEN_END),
  );
};

export const CROUCH_SECONDS = 0.17;
export const CROUCH = 0.86;

// How far a glance pulls back before it goes, as a share of the way.
export const GLANCE_BACK = 0.22;
export const GLANCE_BACK_SECONDS = 0.09;
