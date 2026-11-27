import { CircleCheckIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { assetUrl, BRASS, FOREST, PARCHMENT, PINE, SAGE } from "@/components/brand/assets";

const SUGGESTED = [
  "Give the mark its clear space",
  "Use colors with adequate contrast",
  "Use the logos as provided",
  "Use the full logo when more context is needed",
];

const mark = assetUrl("svg/mark.svg");

/** The mark as a stencil, to show it filled with what it should not be. */
const stencil = (background: string): CSSProperties => ({
  background,
  width: 96,
  height: 89,
  maskImage: `url("${mark}")`,
  maskSize: "contain",
  maskRepeat: "no-repeat",
});

const Mark = ({ style }: { style?: CSSProperties }) => (
  <img src={mark} alt="" className="h-20 w-auto" {...(style ? { style } : {})} />
);

const AVOID: ReadonlyArray<{ text: string; example: ReactNode }> = [
  {
    text: "Stretching or squeezing the mark.",
    example: <Mark style={{ transform: "scaleX(1.5)" }} />,
  },
  {
    text: "Rotating or flipping the mark.",
    example: <Mark style={{ transform: "rotate(-24deg)" }} />,
  },
  {
    text: "Using gradients or several colors in the mark.",
    example: <div style={stencil(`linear-gradient(135deg, ${BRASS}, ${PINE})`)} />,
  },
  {
    text: "Adding shadows or glows.",
    example: <Mark style={{ filter: `drop-shadow(5px 7px 5px ${FOREST}AA)` }} />,
  },
  {
    text: "Using colors without enough contrast.",
    example: <div style={stencil(SAGE)} />,
  },
  {
    text: "Cropping the mark.",
    example: <Mark style={{ transform: "translate(62%, 30%) scale(1.4)" }} />,
  },
  {
    text: "Setting the name in another font.",
    example: (
      <span className="flex items-center gap-2">
        <img src={mark} alt="" className="h-10 w-auto" />
        <span className="font-serif text-3xl italic">reeve</span>
      </span>
    ),
  },
  {
    text: "Stacking the name on top of the mark.",
    example: (
      <span className="relative flex items-center justify-center">
        <Mark />
        <img src={assetUrl("svg/wordmark.svg")} alt="" className="absolute h-8 w-auto max-w-none" />
      </span>
    ),
  },
];

export function BestPractices() {
  return (
    <>
      <h3 className="mt-6 text-[15px] font-semibold">Suggested usage</h3>
      <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
        {SUGGESTED.map((text) => (
          <li key={text} className="flex items-center gap-1.5">
            <CircleCheckIcon className="size-4 shrink-0 text-(--ink)" />
            {text}
          </li>
        ))}
      </ul>
      <h3 className="mt-9 text-[15px] font-semibold">Things to avoid</h3>
      <ul className="mt-3 grid grid-cols-4 gap-x-3 gap-y-4 max-lg:grid-cols-2">
        {AVOID.map((item) => (
          <li key={item.text}>
            <div
              className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border"
              style={{ backgroundColor: PARCHMENT, color: FOREST }}
            >
              {item.example}
              <svg
                aria-hidden="true"
                viewBox="0 0 100 100"
                className="pointer-events-none absolute inset-0 size-full"
              >
                <line x1="10" y1="90" x2="90" y2="10" stroke="#C4512F" strokeWidth="1" />
              </svg>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">{item.text}</p>
          </li>
        ))}
      </ul>
    </>
  );
}

export function InUse() {
  return (
    <div className="my-6 grid grid-cols-2 gap-3 max-md:grid-cols-1">
      <figure className="col-span-2 m-0 overflow-hidden rounded-xl border max-md:col-span-1">
        <img src={assetUrl("png/social-card.png")} alt="reeve's link preview" className="w-full" />
      </figure>
      <figure
        aria-label="A browser tab"
        className="m-0 rounded-xl border p-5"
        style={{ backgroundColor: "#E9E7DB" }}
      >
        <div
          className="flex w-fit max-w-full items-center gap-2 rounded-t-lg px-3 py-2 text-[13px]"
          style={{ backgroundColor: PARCHMENT, color: FOREST }}
        >
          <img src={assetUrl("png/icon-light-32.png")} alt="" className="size-4" />
          reeve – Budget
        </div>
        <div className="h-16 rounded-b-lg rounded-tr-lg" style={{ backgroundColor: PARCHMENT }} />
      </figure>
      <figure
        aria-label="The command line"
        className="m-0 rounded-xl p-5 font-mono text-xs leading-relaxed"
        style={{ backgroundColor: FOREST, color: PARCHMENT }}
      >
        <div>
          <span style={{ color: SAGE }}>$</span> reeve budget show
        </div>
        <div>
          <span style={{ color: SAGE }}>$</span> reeve reports net-worth
        </div>
        <div>
          <span style={{ color: SAGE }}>$</span> reeve mcp
        </div>
      </figure>
    </div>
  );
}
