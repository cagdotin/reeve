/** Title case for imported payee names, ported from Actual's `accounts/title`. */

const conjunctions = ["for", "and", "nor", "but", "or", "yet", "so"];
const articles = ["a", "an", "the"];
// prettier-ignore
const prepositions = [
  "aboard", "about", "above", "across", "after", "against", "along", "amid", "among", "anti",
  "around", "as", "at", "before", "behind", "below", "beneath", "beside", "besides", "between",
  "beyond", "but", "by", "concerning", "considering", "despite", "down", "during", "except",
  "excepting", "excluding", "following", "for", "from", "in", "inside", "into", "like", "minus",
  "near", "of", "off", "on", "onto", "opposite", "over", "past", "per", "plus", "regarding",
  "round", "save", "since", "than", "through", "to", "toward", "towards", "under", "underneath",
  "unlike", "until", "up", "upon", "versus", "via", "with", "within", "without",
];
const lowerCase = new Set([...conjunctions, ...articles, ...prepositions]);

// prettier-ignore
const specials = [
  "CLI", "API", "HTTP", "HTTPS", "JSX", "DNS", "URL", "CI", "CDN", "GitHub", "CSS", "JS",
  "JavaScript", "TypeScript", "HTML", "WordPress", "Next.js", "Node.js",
];
const specialPatterns = specials.map(
  (special) => [new RegExp(`\\b${special}\\b`, "gi"), special] as const,
);

const character = "[\\p{L}\\p{N}]";
const word = new RegExp(
  `(?:(?:(\\s?(?:^|[.\\(\\)!?;:"-])\\s*)(${character}))|(${character}))(${character}*[’']*${character}*)`,
  "gu",
);

const parseMatch = (match: string): string | null => {
  const first = match[0] ?? "";
  if (/\s/.test(first)) return match.substring(1);
  if (/[()]/.test(first)) return null;
  return match;
};

export const titleCase = (text: string): string => {
  let result = text
    .toLowerCase()
    .replace(
      word,
      (
        match: string,
        lead: string | undefined,
        forced: string | undefined,
        lower: string | undefined,
        rest: string,
      ) => {
        const parsed = parseMatch(match);
        if (parsed === null) return match;
        if (forced === undefined && lowerCase.has((lower ?? "") + rest)) return parsed;
        return (lead ?? "") + (lower ?? forced ?? "").toUpperCase() + rest;
      },
    );
  for (const [pattern, special] of specialPatterns) result = result.replace(pattern, special);
  return result;
};
