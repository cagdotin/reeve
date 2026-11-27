const WEIGHTS = [
  { name: "Regular", value: 400, use: "Body text and tables" },
  { name: "Medium", value: 500, use: "Labels and navigation" },
  { name: "Semibold", value: 600, use: "Headings" },
  { name: "Bold", value: 700, use: "Dialog titles and key figures" },
];

const FIGURES = ["1,204.50", "87.25", "12,950.00", "-340.10"];

export function Typography() {
  return (
    <div className="my-6 grid grid-cols-[1fr_1.3fr] gap-3 max-md:grid-cols-1">
      <div className="flex flex-col justify-between rounded-xl border bg-card p-6">
        <div>
          <div className="text-8xl leading-none font-semibold tracking-tight">Aa</div>
          <div className="mt-3 text-2xl font-semibold tracking-tight">Geist</div>
          <p className="mt-2 text-[13px] text-muted-foreground">
            Words and figures. Geist Mono sets code.
          </p>
        </div>
        <a
          href="https://fonts.google.com/specimen/Geist"
          target="_blank"
          rel="noreferrer"
          className="mt-5 text-[13px] font-medium text-(--ink) underline underline-offset-2"
        >
          Get Geist
        </a>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {WEIGHTS.map((weight) => (
          <li key={weight.value} className="flex items-center gap-4 px-5 py-3.5">
            <span className="text-2xl" style={{ fontWeight: weight.value }}>
              Aa
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm" style={{ fontWeight: weight.value }}>
                {weight.name}
              </span>
              <span className="block text-xs text-muted-foreground">{weight.use}</span>
            </span>
            <span className="text-sm text-muted-foreground tabular-nums">{weight.value}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-xl border bg-card p-5">
        <div className="text-sm font-medium">Figures</div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Money uses tabular figures, so columns line up.
        </p>
        <div className="mt-3 text-right text-sm tabular-nums">
          {FIGURES.map((figure) => (
            <div key={figure}>{figure}</div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border bg-card p-5">
        <div className="text-sm font-medium">Code</div>
        <p className="mt-1 text-[13px] text-muted-foreground">
          The system's monospace, only for formulas, JSON, commands and URLs.
        </p>
        <pre className="mt-3 overflow-hidden rounded-md bg-muted p-3 font-mono text-xs">
          reeve budget show
        </pre>
      </div>
    </div>
  );
}
