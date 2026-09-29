export interface HoldSignal {
  readonly held: boolean;
  released(): Promise<void>;
}

export type HoldController = {
  readonly signal: HoldSignal;
  hold(): void;
  release(): void;
};

export const createHoldController = (): HoldController => {
  let held = false;
  let waiters: (() => void)[] = [];

  const signal: HoldSignal = {
    get held() {
      return held;
    },
    released: () =>
      held
        ? new Promise<void>((resolve) => {
            waiters.push(resolve);
          })
        : Promise.resolve(),
  };

  return {
    signal,
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      const pending = waiters;
      waiters = [];
      for (const resolve of pending) resolve();
    },
  };
};
