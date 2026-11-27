import type { ReactNode } from "react";

/** Each text with a key of its own: the text, and its occurrence when it repeats. */
const keyed = (texts: ReadonlyArray<string>) => {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const count = seen.get(text) ?? 0;
    seen.set(text, count + 1);
    return { text, key: `${count}:${text}` };
  });
};

/** Bold, italics and inline code within a line. */
const inline = (text: string): Array<ReactNode> =>
  keyed(text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g)).map(({ text: part, key }) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`"))
      return (
        <code key={key} className="rounded bg-muted px-1 font-mono text-[0.9em]">
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
      return <em key={key}>{part.slice(1, -1)}</em>;
    return part;
  });

const LIST_ITEM = /^\s*([-*]|\d+\.)\s+/;

function Block({ block }: { block: string }) {
  const lines = block.split("\n");
  const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0]!);
  if (heading) {
    const rest = lines.slice(1).join(" ");
    return (
      <>
        <p
          className={heading[1]!.length <= 2 ? "text-base font-semibold" : "text-sm font-semibold"}
        >
          {inline(heading[2]!)}
        </p>
        {rest !== "" && <p>{inline(rest)}</p>}
      </>
    );
  }
  if (lines.every((line) => LIST_ITEM.test(line))) {
    const items = keyed(lines).map(({ text, key }) => (
      <li key={key}>{inline(text.replace(LIST_ITEM, ""))}</li>
    ));
    return /^\s*\d+\./.test(lines[0]!) ? (
      <ol className="list-decimal ps-5">{items}</ol>
    ) : (
      <ul className="list-disc ps-5">{items}</ul>
    );
  }
  return <p>{inline(lines.join(" "))}</p>;
}

/** The markdown a text widget holds: headings, paragraphs, lists, emphasis and code. */
export function Markdown({
  source,
  align = "left",
}: {
  source: string;
  align?: "left" | "right" | "center" | undefined;
}) {
  return (
    <div className="grid gap-2 text-[13px] leading-relaxed" style={{ textAlign: align }}>
      {keyed(source.trim().split(/\n{2,}/)).map(({ text, key }) => (
        <Block key={key} block={text} />
      ))}
    </div>
  );
}
