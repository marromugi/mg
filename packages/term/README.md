# @mg/term

A small package that decorates the output you write to a terminal.

## Features

- Coloring functions picked by meaning. There are five: success, error, warning, muted, and strong.
- Marks (emoji) for the same five meanings.
- Terminal detection. Color is removed when the output is not a terminal or when `NO_COLOR` is set, and added when `FORCE_COLOR` is set.
- A factory that lets you swap the output target and the environment.

It depends on no other package and no outside library.
Colors are written with its own control codes.

## Usage

The default `term` is built from standard output and the real environment variables.

```ts
import { term } from "@mg/term";

console.log(term.paint("success", "done"));
console.log(`${term.mark.error} failed`);
```

## API

### `createTerm(options)`

To swap the output target or the environment, use `createTerm`.
Tests use it to pin whether the output is a terminal and what the environment variables are.

```ts
import { createTerm } from "@mg/term";

const t = createTerm({ isTTY: true, env: { NO_COLOR: "1" } });
t.colorEnabled; // false
```

## How it works

### Deciding `colorEnabled`

`colorEnabled` is decided in this order.

1. If `FORCE_COLOR` is set, not empty, and not `"0"`, color is on.
2. Otherwise, if `NO_COLOR` is set, color is off.
3. Otherwise, if the output is not a terminal, color is off.
4. In every other case, color is on.

Marks are always added, whatever this decision is.

## Non-goals

- It has no functions that write events (messages, tool calls, per-case results) to the terminal.
- It has no log levels, timestamps, or writing to files.
