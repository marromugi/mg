import { tv } from "tailwind-variants";

// The look shared by the lists of options that open from a control: the
// panel, and one row in it. `active` marks the row the keyboard is on.
export const optionList = tv({
  base: "flex flex-col rounded-container border border-edge bg-surface-raised container-p-1 text-sm around-control-py-2",
});

export const optionRow = tv({
  base: "flex w-full cursor-pointer items-center justify-between gap-3 rounded-control px-3 control-py-2 text-left transition duration-160 ease-out outline-none hover:bg-edge focus-visible:bg-edge",
  variants: {
    active: { yes: "bg-edge", no: "" },
  },
  defaultVariants: { active: "no" },
});
