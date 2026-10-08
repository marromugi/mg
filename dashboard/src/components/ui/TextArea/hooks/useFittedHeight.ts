export type Measured = {
  // The height the text needs, padding included, borders not.
  content: number;
  // The height of one line of text.
  line: number;
  // The top and bottom padding together.
  padding: number;
  // The top and bottom borders together.
  borders: number;
};

export type Fitted = { height: number; scrolls: boolean };

// The height that shows all of the text, up to `maxRows` lines. Past
// that the height stops growing and the text scrolls.
export const useFittedHeight = (
  measured: Measured,
  maxRows: number,
): Fitted => {
  const wanted = measured.content + measured.borders;
  const most =
    maxRows * measured.line + measured.padding + measured.borders;
  return wanted > most
    ? { height: most, scrolls: true }
    : { height: wanted, scrolls: false };
};
