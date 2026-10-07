import {
  autoUpdate,
  flip,
  offset,
  shift,
  size,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from "@floating-ui/react";
import { useRef } from "react";

const VIEWPORT_MARGIN = 8;

// Ties a text control to the list of options that opens under it: where
// the list sits, that it is as wide as the control, closing on Escape or
// a press outside, and moving through the rows with the arrow keys while
// the focus stays in the control.
export const useOptionPanel = ({
  open,
  onOpenChange,
  active,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  active: number | null;
  onNavigate: (active: number | null) => void;
}) => {
  const rows = useRef<(HTMLElement | null)[]>([]);
  const { refs, floatingStyles, context } =
    useFloating<HTMLInputElement>({
      open,
      onOpenChange,
      placement: "bottom-start",
      whileElementsMounted: autoUpdate,
      middleware: [
        offset(4),
        flip({ padding: VIEWPORT_MARGIN }),
        shift({ padding: VIEWPORT_MARGIN }),
        size({
          apply: ({ rects, elements }) => {
            elements.floating.style.minWidth = `${rects.reference.width}px`;
          },
        }),
      ],
    });
  const { getReferenceProps, getFloatingProps, getItemProps } =
    useInteractions([
      useRole(context, { role: "listbox" }),
      useDismiss(context),
      useListNavigation(context, {
        listRef: rows,
        activeIndex: active,
        onNavigate,
        virtual: true,
        loop: true,
      }),
    ]);

  return {
    rows,
    setControl: refs.setReference,
    setPanel: refs.setFloating,
    panelStyles: floatingStyles,
    getControlProps: getReferenceProps,
    getPanelProps: getFloatingProps,
    getRowProps: getItemProps,
  };
};

export type OptionPanelState = ReturnType<typeof useOptionPanel>;
