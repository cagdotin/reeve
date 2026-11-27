import { Parser, type ParserOptions } from "xml2js";

/** Parses XML with xml2js, whose callback runs synchronously when `async` is off. */
export const parseXml = (text: string, options: ParserOptions): any => {
  let done = false;
  let error: unknown = null;
  let result: unknown = null;
  new Parser({ ...options, async: false }).parseString(text, (err: unknown, value: unknown) => {
    if (done) return;
    done = true;
    error = err;
    result = value;
  });
  if (!done) throw new Error("The XML parser did not finish");
  if (error !== null) throw error instanceof Error ? error : new Error(String(error));
  return result;
};
