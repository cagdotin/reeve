/**
 * A small parsing-expression engine with peggy's semantics: ordered choice that commits, greedy
 * repetition, `!` and `&{}` predicates, rules with display names, and peggy's error report (the
 * expectations at the farthest position that failed, as "Expected … but … found.").
 */

export const FAIL: unique symbol = Symbol("fail");
type Fail = typeof FAIL;

type Expectation =
  | { readonly type: "literal"; readonly text: string; readonly ignoreCase: boolean }
  | { readonly type: "class"; readonly description: string }
  | { readonly type: "any" }
  | { readonly type: "end" }
  | { readonly type: "other"; readonly description: string };

export interface State {
  readonly input: string;
  pos: number;
  maxFailPos: number;
  expected: Array<Expectation>;
  silent: number;
}

export type Parser<T> = (state: State) => T | Fail;

const fail = (state: State, expectation: Expectation): Fail => {
  if (state.silent > 0 || state.pos < state.maxFailPos) return FAIL;
  if (state.pos > state.maxFailPos) {
    state.maxFailPos = state.pos;
    state.expected = [];
  }
  state.expected.push(expectation);
  return FAIL;
};

export const lit =
  (text: string, ignoreCase = false): Parser<string> =>
  (state) => {
    const slice = state.input.substr(state.pos, text.length);
    if (ignoreCase ? slice.toLowerCase() === text.toLowerCase() : slice === text) {
      state.pos += text.length;
      return slice;
    }
    return fail(state, { type: "literal", text, ignoreCase });
  };

/** One character the test accepts; `description` is how peggy prints the class. */
export const cls =
  (test: RegExp, description: string): Parser<string> =>
  (state) => {
    const char = state.input.charAt(state.pos);
    if (char !== "" && test.test(char)) {
      state.pos += 1;
      return char;
    }
    return fail(state, { type: "class", description });
  };

export const any: Parser<string> = (state) => {
  if (state.pos < state.input.length) {
    const char = state.input.charAt(state.pos);
    state.pos += 1;
    return char;
  }
  return fail(state, { type: "any" });
};

type Values<T extends ReadonlyArray<Parser<unknown>>> = {
  -readonly [K in keyof T]: T[K] extends Parser<infer V> ? V : never;
};

export const seq =
  <T extends ReadonlyArray<Parser<unknown>>>(...parsers: T): Parser<Values<T>> =>
  (state) => {
    const start = state.pos;
    const values: Array<unknown> = [];
    for (const parser of parsers) {
      const value = parser(state);
      if (value === FAIL) {
        state.pos = start;
        return FAIL;
      }
      values.push(value);
    }
    return values as Values<T>;
  };

export const alt =
  <T>(...parsers: ReadonlyArray<Parser<T>>): Parser<T> =>
  (state) => {
    for (const parser of parsers) {
      const value = parser(state);
      if (value !== FAIL) return value;
    }
    return FAIL;
  };

export const opt =
  <T>(parser: Parser<T>): Parser<T | null> =>
  (state) => {
    const value = parser(state);
    return value === FAIL ? null : value;
  };

export const star =
  <T>(parser: Parser<T>): Parser<Array<T>> =>
  (state) => {
    const values: Array<T> = [];
    for (;;) {
      const value = parser(state);
      if (value === FAIL) return values;
      values.push(value);
    }
  };

export const plus =
  <T>(parser: Parser<T>): Parser<Array<T>> =>
  (state) => {
    const values = star(parser)(state);
    return values === FAIL || values.length === 0 ? FAIL : values;
  };

export const map =
  <T, U>(parser: Parser<T>, f: (value: T, text: string) => U): Parser<U> =>
  (state) => {
    const start = state.pos;
    const value = parser(state);
    return value === FAIL ? FAIL : f(value, state.input.slice(start, state.pos));
  };

/** peggy's `$`: the text the expression matched. */
export const text = <T>(parser: Parser<T>): Parser<string> => map(parser, (_, matched) => matched);

/** peggy's `!expr`. */
export const not =
  <T>(parser: Parser<T>): Parser<undefined> =>
  (state) => {
    const start = state.pos;
    state.silent += 1;
    const value = parser(state);
    state.silent -= 1;
    state.pos = start;
    return value === FAIL ? undefined : FAIL;
  };

/** peggy's `&{ … }`, on the value just matched. */
export const where =
  <T>(parser: Parser<T>, test: (value: T) => boolean): Parser<T> =>
  (state) => {
    const start = state.pos;
    const value = parser(state);
    if (value === FAIL) return FAIL;
    if (test(value)) return value;
    state.pos = start;
    return FAIL;
  };

/** A rule with a display name: its failures report the name rather than what is inside it. */
export const named =
  <T>(name: string, parser: Parser<T>): Parser<T> =>
  (state) => {
    state.silent += 1;
    const value = parser(state);
    state.silent -= 1;
    return value === FAIL ? fail(state, { type: "other", description: name }) : value;
  };

/** Lets a rule refer to one defined below it. */
export const lazy =
  <T>(get: () => Parser<T>): Parser<T> =>
  (state) =>
    get()(state);

const hex = (char: string) => char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
const special: Record<string, string> = {
  "\\": "\\\\",
  '"': '\\"',
  "\0": "\\0",
  "\t": "\\t",
  "\n": "\\n",
  "\r": "\\r",
};

const escape = (value: string) =>
  value
    .split("")
    .map((char) => {
      const code = char.charCodeAt(0);
      return (
        special[char] ?? (code < 0x20 || (code >= 0x7f && code <= 0x9f) ? `\\x${hex(char)}` : char)
      );
    })
    .join("");

const describe = (expectation: Expectation) => {
  switch (expectation.type) {
    case "literal":
      return `"${escape(expectation.text)}"`;
    case "class":
    case "other":
      return expectation.description;
    case "any":
      return "any character";
    case "end":
      return "end of input";
  }
};

/** peggy's syntax error, with its message and where the input stopped matching. */
export class TemplateSyntaxError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = "SyntaxError";
    this.offset = offset;
  }
}

const message = (expected: ReadonlyArray<Expectation>, found: string | null) => {
  const descriptions = [...new Set(expected.map(describe))].sort();
  const list =
    descriptions.length <= 2
      ? descriptions.join(" or ")
      : `${descriptions.slice(0, -1).join(", ")}, or ${descriptions.at(-1)}`;
  return `Expected ${list} but ${found === null ? "end of input" : `"${escape(found)}"`} found.`;
};

/** Parses the whole input with the start rule, or throws peggy's error. */
export const run = <T>(start: Parser<T>, input: string): T => {
  const state: State = { input, pos: 0, maxFailPos: 0, expected: [], silent: 0 };
  const value = start(state);
  if (value !== FAIL && state.pos === input.length) return value;
  if (value !== FAIL) fail(state, { type: "end" });
  const found = state.maxFailPos < input.length ? input.charAt(state.maxFailPos) : null;
  throw new TemplateSyntaxError(message(state.expected, found), state.maxFailPos);
};
