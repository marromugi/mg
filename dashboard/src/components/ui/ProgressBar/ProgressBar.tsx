import { MotionConfig, motion } from "motion/react";

type ProgressBarProps = {
  label: string;
  // How much is done, from 0 to 1.
  value: number;
};

// A bar that fills from the leading end as `value` grows.
export const ProgressBar = ({ label, value }: ProgressBarProps) => {
  const done = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(done * 100)}
      className="h-2 w-full overflow-hidden rounded-full bg-edge"
    >
      <MotionConfig reducedMotion="user">
        <motion.div
          className="h-full rounded-full bg-accent"
          initial={false}
          animate={{ width: `${done * 100}%` }}
          transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
        />
      </MotionConfig>
    </div>
  );
};
