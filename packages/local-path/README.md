# @mg/local-path

A package that decides whether a text names a local path absolutely on this machine.

## Features

- Tells whether a text is an absolute path.
  A path is absolute when it does not depend on the working directory.
  On Windows it must also not depend on the current drive.
- Turns a checked text into the absolute path type of `@mg/core`.
  It throws a `RangeError` for a text that is not absolute.
- Takes the platform's path rules from its caller.
  They default to the host's, so POSIX and Windows rules can be checked on any machine.

## Usage

```ts
import { win32 } from "node:path";
import { isAbsolutePath, toAbsolutePath } from "@mg/local-path";

isAbsolutePath("/etc/hosts");
isAbsolutePath("C:x", win32); // false
toAbsolutePath("src/a.ts"); // throws RangeError
```

It does not check that links are followed.
That promise stays with the code that builds the path.
