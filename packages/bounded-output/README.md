# @mg/bounded-output

A package that cuts a text to a limit, keeps the whole in a file, and words the closing line that says what was cut.

## Features

- Takes a text in chunks and keeps only what fits in a byte limit.
- Keeps either end of the text: its start or its end.
- The kept part starts or ends at a line boundary whenever a whole line fits.
- When one line alone is over the limit, it keeps that line's first or last bytes, cut on a character boundary.
- When the text passes the limit, the whole of it is saved to `<dir>/<random id>.txt`.
  A text within the limit leaves no file.
- Stops saving at a size cap, tells its caller to stop producing, and reports that the cap was reached.
- Words the closing line that names what is shown and where the full text is.
- Never deletes the files it writes.

## Usage

```ts
import { closingLine, createBoundedOutput } from "@mg/bounded-output";

const output = createBoundedOutput({
  maxBytes: 16384, // most bytes kept in the result
  dir: "/tmp/mg-output", // where the full text is saved
  maxSavedBytes: 67108864, // most bytes saved to one file
  keep: "start", // "start" or "end"
  onStop: () => {}, // called once when the producer should stop
});
output.append(Buffer.from("first chunk\n"));
const report = await output.finish();
const closing = closingLine(report); // undefined when nothing was cut
```

`finish` returns a report: the kept `text`, the `shownLines`, whether only part of one line is shown, the totals, `savedPath` when a file was written, and `savedCapReached`.

## Closing line

`closingLine(report)` returns `undefined` when nothing was cut.
Otherwise it returns one of these forms.

| Kept  | Cut by lines                                                                 | First line alone is over the limit                                                             |
| ----- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| start | `[showing lines 1-212 of 1840 (16.0 KB of 71.3 KB). Full output: <path>]`    | `[showing the first 16.0 KB of line 1 (line is 40.2 KB; 71.3 KB in all). Full output: <path>]` |
| end   | `[showing lines 3363-5000 of 5000 (8.0 KB of 23.3 KB). Full output: <path>]` | `[showing the last 3 B of line 2 (line is 15 B; 19 B in all). Full output: <path>]`            |

## Failure

When the file cannot be written, `finish` rejects with `OutputSaveError`.
It names the path and the cause, and `onStop` is called.

## Non-goals

- It does not read the saved file back.
- It does not delete saved files.
