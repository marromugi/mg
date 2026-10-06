# @mg/tools

A package of the built-in tools that harnesses share.

## Features

- Holds the implementations of the built-in tools.
- Every tool is built with the core tool type. You can pass it straight to the core run function.
- Argument schemas are written with zod. This is the only place that holds schema implementations.
- Code that depends on the environment, such as child processes, stays inside this package.
- The working directory and time limits are taken when a tool is created.

## Usage

Create the tools you need, then pass them to a harness.

```ts
import { createBashTool, createReadFileTool } from "@mg/tools";

const tools = [
  createBashTool({ cwd: "/path/to/work" }),
  createReadFileTool({ root: "/path/to/work" }),
];
```

## API

This table lists the tools included today.

| Tool         | What it does                                    | Options                        |
| ------------ | ----------------------------------------------- | ------------------------------ |
| `bash`       | Runs one command in a shell                     | 6, including working directory |
| `web_search` | Searches the web through a search backend       | 3, including backend           |
| `read_file`  | Reads a text file under the root                | 2, including root              |
| `write_file` | Writes a whole file under the root              | 1: root                        |
| `edit_file`  | Fixes part of a file by matching the old string | 1: root                        |
| `grep`       | Searches file contents with ripgrep             | 6, including root              |

### bash

The only argument taken from the LLM is one command string.

There are 6 options when creating it.
Only the working directory is required.
The others default to the values in the example when omitted.

```ts
createBashTool({
  cwd: "/path/to/work", // working directory
  timeoutMs: 30000, // time limit (milliseconds)
  shell: "/bin/sh", // shell to use
  maxOutputBytes: 8192, // most bytes of output returned (bytes)
  overflowDir: "/tmp/mg-bash-output", // where full outputs are saved (default: <os temp dir>/mg-bash-output)
  maxSavedBytes: 67108864, // most bytes saved to one file (bytes)
});
```

The result is returned as one string.

- It includes standard output and standard error merged in the order they arrive, and the exit code.
- A non-zero exit code does not throw.
- A timeout does not throw either. The result says so.
- If the output goes over `maxOutputBytes`, only its end is returned.
  It starts at the beginning of a line whenever a whole line fits.
  The full output is saved to `<overflowDir>/<random id>.txt`, and a last line gives the path.
  Small outputs leave no file.
  The tool never deletes these files.
- If the last line alone is longer than the limit, the last bytes of that line are returned.
- If the output passes `maxSavedBytes`, the command is stopped.
  The file keeps the first `maxSavedBytes`, and the result says so.
- If the file cannot be written, the command is stopped and the call fails with an error naming the path and the cause.
- The tool description tells the LLM about the limit and the file.
- When stopped by an abort signal (AbortSignal), the exception passes through as is.

### web_search

A tool that searches the web. It holds no code that actually searches.

The search itself is left to a backend.
The backend takes a query and a result limit.
It returns a list of titles, URLs, and snippets.

```ts
type WebSearchBackend = {
  name: string;
  search(
    request: { query: string; maxResults: number },
    context: { signal?: AbortSignal },
  ): Promise<{ title: string; url: string; snippet: string }[]>;
};
```

The only argument taken from the LLM is the query string.

There are 3 options when creating it.
Only the backend is required.
The others default to the values in the example when omitted.

```ts
createWebSearchTool({
  backend: myBackend, // search backend
  maxResults: 5, // maximum number of results returned
  maxSnippetChars: 500, // maximum snippet length in characters
});
```

The result is returned as one piece of text.

- Each result lists its title, URL, and snippet, numbered.
- Line breaks and runs of whitespace in a snippet are collapsed to one, then the snippet is cut at the character limit.
- A cut snippet ends with "…".
- Even if the backend returns more results than the limit, the tool cuts them down to the limit.
- If there are no results, the text says so.

When the backend fails, its exception passes through as is.
The tool does not wrap backend exceptions.

A backend implementation can throw a dedicated exception for search failures.

```ts
new WebSearchError("description of the failure", {
  cause: originalError,
});
```

#### Ollama backend

A backend that uses the Ollama search API. It talks to the ollama.com server, not a local Ollama.

You can create an API key with a free ollama.com account.

```ts
createOllamaWebSearchBackend({
  apiKey: "your-api-key", // ollama.com API key
  baseUrl: "https://ollama.com", // server to connect to; this value when omitted
  headers: {}, // extra headers to send
  fetch: globalThis.fetch, // function used for requests
});
```

Only the API key is required. The others default to the values in the example when omitted.

| Option    | Required | What it does                  |
| --------- | -------- | ----------------------------- |
| `apiKey`  | Required | Passes the ollama.com API key |
| `baseUrl` | Optional | Replaces the server URL       |
| `headers` | Optional | Adds headers to send          |
| `fetch`   | Optional | Replaces the request function |

Use this backend together with the `web_search` tool.

```ts
createWebSearchTool({
  backend: createOllamaWebSearchBackend({ apiKey: "your-api-key" }),
});
```

The Ollama search API returns at most 10 results per search.
Passing a larger `maxResults` still returns at most 10.

### Shared rules for file tools

Rules shared by `read_file` and the other tools that handle files.
Tools added later follow these rules too.

- A root directory is taken when the tool is created.
- The root cannot be omitted.
- A path passed from the LLM is read as relative to the root.
- Absolute paths are accepted too, but refused if outside the root.
- Whether a path is inside the root is checked after resolving symbolic links.
- Being outside the root and read failures are reported as `FileToolError`.
- Line numbers count from 1.
- Character positions also count from 1.
- Character positions are counted in Unicode code points within the line.
- A range includes its start and excludes its end character position.
- When only a line is given, the whole line is included.

### read_file

A tool that reads a text file under the root.
Only UTF-8 is supported.

The arguments taken from the LLM are the file path and an optional range.
A range has a `start` and an optional `end`.
Each takes a line number and an optional character position.

```ts
type ReadFileInput = {
  path: string;
  range?: {
    start: { line: number; col?: number };
    end?: { line: number; col?: number };
  };
};
```

There are 2 options when creating it.
Only the root is required.
The other defaults to the value in the example when omitted.

```ts
createReadFileTool({
  root: "/path/to/root", // root directory
  maxOutputChars: 100000, // output limit (characters)
});
```

The result is returned as one string.

- Each line starts with its line number and a tab.
- Without a range, the whole file is returned.
- With only `start`, the file is returned from that line to the end.
- With character positions in the range, the first and last lines are cut at those positions.
- If the output goes over `maxOutputBytes`, only its end is returned.
  It starts at the beginning of a line whenever a whole line fits.
  The full output is saved to `<overflowDir>/<random id>.txt`, and a last line gives the path.
  Small outputs leave no file.
  The tool never deletes these files.
- If the last line alone is longer than the limit, the last bytes of that line are returned.
- If the output passes `maxSavedBytes`, the command is stopped.
  The file keeps the first `maxSavedBytes`, and the result says so.
- If the file cannot be written, the command is stopped and the call fails with an error naming the path and the cause.
- The tool description tells the LLM about the limit and the file.
- An empty file returns the string `(empty file)`.

It throws `FileToolError` in these cases.

- The file does not exist.
- The path is a directory.
- The file is binary.
- The line does not exist in the file.

### write_file

A tool that writes a whole file.
Use it to create a new file or to replace all of one.

It overwrites. An existing file is replaced without warning.
If the parent directory does not exist, it is created first.

The arguments taken from the LLM are the file path and content.

```ts
type WriteFileInput = {
  path: string;
  content: string;
};
```

The only option when creating it is the root. It cannot be omitted.

```ts
createWriteFileTool({
  root: "/path/to/root", // root directory
});
```

The result is returned as one string. It includes the number of lines written.

- Writing an empty file returns 0 lines.

It throws `FileToolError` in this case.

- The path is a directory.

### edit_file

A tool that fixes part of a file.
The place is found by matching the old string, not by line number.

Whether it replaces depends on the number of matches.

- With exactly 1 match, it replaces it with the new string.
- With 0 matches, it fails, saying the string was not found.
- With 2 or more matches and no replace-all flag, it fails.
- With 2 or more matches and the flag set, it replaces them all.

The arguments taken from the LLM are path, oldString, and newString.
It also takes replaceAll, the flag to replace every match.

```ts
type EditFileInput = {
  path: string;
  oldString: string;
  newString: string;
  replaceAll?: boolean;
};
```

The only option when creating it is the root. It cannot be omitted.

```ts
createEditFileTool({
  root: "/path/to/root", // root directory
});
```

The result is returned as one string. It includes the number of replacements and their line numbers.

It throws `FileToolError` in these cases.

- The path is a directory.
- The old string is not found.
- The old string and the new string are the same.
- The old string matches in 2 or more places and the flag is not set.

The failure for 2 or more matches includes the count and the line numbers.
It also includes wording that asks for more surrounding text to narrow it to one match.

```
oldString matches 2 times in foo.txt (lines 3, 10). Include more surrounding text to make it unique, or set replaceAll.
```

### grep

A tool that searches file contents with ripgrep.
It returns the places it finds in a form `read_file` can take as is.

The machine it runs on must have ripgrep installed.
It must be on the PATH under the name `rg`.
On a machine without it, this is reported as `FileToolError`.

The argument taken from the LLM is a regular expression, pattern.
It also takes path, where to search, and glob, to narrow file names.
It also takes ignoreCase, the flag to ignore case.

```ts
type GrepInput = {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
};
```

Without path, it searches the whole root.

There are 6 options when creating it.
Only the root is required.
The others default to the values in the example when omitted.

```ts
createGrepTool({
  root: "/path/to/root", // root directory
  rgPath: "rg", // ripgrep executable
  timeoutMs: 30000, // time limit (milliseconds)
  maxResults: 200, // maximum number of results returned
  maxLineChars: 300, // maximum line length in characters
  maxOutputBytes: 8388608, // output limit (bytes)
});
```

The result is returned as one string.

- Each match becomes one line in the form `path:line:col: text`.
- The path is relative to the root.
- Line numbers and character positions are counted the same way as in `read_file`.
- If one line has several matches, each is returned on its own line.
- If a line ends with CRLF, both `\r` and `\n` are dropped.
- Hidden files and files inside hidden directories are searched. The inside of `.git` is searched too.
- Files listed in `.gitignore` are not searched.
- When nothing matches, the text says so. This is not a failure.
- When path is omitted, the place is written as `the root`.
- When the count goes over the limit, the results are truncated. `[results truncated]` is added as the marker.
- When truncation leaves no match at all, only the marker is returned.
- Matches that are not UTF-8 are not returned. The count is given in the note `[skipped N matches: not valid UTF-8]`.
- Matches in files judged binary during the directory search are not returned either. The count is given in the note `[skipped N matches: binary file]`.
- These 2 notes do not count toward the result limit.
- Even with no match lines, those alone may be returned. This happens when there is a truncation marker or a UTF-8 or binary note. The no-match text is not added.
- Long lines are also truncated at the character limit and end with `…`.

If the search area contains unreadable files, it does not fail.
It returns the matches it found and gives the reasons for the unreadable files in a note at the end.

- The note starts with the line `[search incomplete: ripgrep reported errors]`.
- Next come the non-empty lines of ripgrep's error output, up to the first 5.
- From the 6th line on, they are collapsed into one line, `... and M more lines`. M is the number of remaining lines.
- A line in the form "rg: absolute path: reason" is rewritten as "relative path: reason". The relative path is from the root.
- A line that cannot be read in this form is included as is, with only the leading `rg: ` removed.
- This note comes after the other notes.
- When nothing matches, the same note is added after the no-match text.
- When output is cut at the byte limit, the same note is added if there is error output.

It throws `FileToolError` in these cases.

- ripgrep is not installed on the machine.
- The regular expression is invalid.
- It times out.
- The path points outside the root.
- The path points directly at a binary file.

## Non-goals

- It does not talk to providers. Talking to the LLM is core's job.
- It does not repeat tool calls. That is the harness's job.
