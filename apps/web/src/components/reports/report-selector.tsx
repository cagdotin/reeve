import { useQuery } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { ChevronDownIcon, SearchIcon } from "lucide-react";
import { Button } from "@reeve/ui/components/button";
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxTrigger,
} from "@reeve/ui/components/combobox";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import { REPORT_LIBRARY, savedReportPlace } from "@/lib/report-library";

interface Choice {
  readonly key: string;
  readonly label: string;
  /** For a saved report, the kind of report it is. */
  readonly kind?: string;
  readonly about: string;
  readonly to: string;
  readonly search: Record<string, unknown>;
}

interface ChoiceGroup {
  readonly value: string;
  readonly items: Array<Choice>;
}

const keyOf = (to: string, search: Record<string, unknown>) => {
  const saved = search["report"] ?? search["id"];
  return typeof saved === "string" ? `${to}?${saved}` : to;
};

const choice = (label: string, about: string, to: string, search = {}): Choice => ({
  key: keyOf(to, search),
  label,
  about,
  to,
  search,
});

const ALL_REPORTS = choice("All reports", "Every report and report tool", "/reports");

const BUILT_IN: ReadonlyArray<ChoiceGroup> = REPORT_LIBRARY.map((group) => ({
  value: group.label,
  items: group.reports.map((report) => choice(report.label, report.about, report.to)),
}));
const LIBRARY = REPORT_LIBRARY.flatMap((group) => group.reports);

const matches = (item: Choice, query: string) =>
  `${item.label} ${item.about}`.toLowerCase().includes(query.trim().toLowerCase());

/**
 * Which report the Reports tab shows, right after the tabs: All reports, a saved report or a built-in
 * one. Picking one opens it with its own settings, never the shown report's filters (docs/rules/reports.md).
 */
export function ReportSelector({ name }: { name: string }) {
  const { id: book } = useBook();
  const navigate = useNavigate();
  const location = useRouterState({ select: (state) => state.location });
  const saved = useQuery(bookQuery(book, "list_saved_reports", {}));
  const savedItems = (saved.data ?? [])
    .flatMap((report) => {
      if (!("definition" in report)) return [];
      const place = savedReportPlace(report.definition.type, report.id);
      const kind = LIBRARY.find((entry) => entry.to === place.to);
      return kind === undefined
        ? []
        : [
            {
              ...choice(report.name, kind.about, place.to, place.search),
              kind: kind.label,
            },
          ];
    })
    .sort((a, b) => a.label.localeCompare(b.label));
  const groups: Array<ChoiceGroup> = [
    { value: "", items: [ALL_REPORTS] },
    ...(savedItems.length > 0 ? [{ value: "Saved reports", items: savedItems }] : []),
    ...BUILT_IN,
  ];
  const here = keyOf(location.pathname, location.search);
  const current = groups.flatMap((group) => group.items).find((item) => item.key === here) ?? null;
  return (
    <Combobox<Choice>
      items={groups}
      value={current}
      onValueChange={(next) => {
        if (next !== null && next.key !== here) void navigate({ to: next.to, search: next.search });
      }}
      itemToStringLabel={(item) => item.label}
      itemToStringValue={(item) => item.key}
      isItemEqualToValue={(item, value) => item.key === value.key}
      filter={matches}
      autoHighlight
    >
      <ComboboxTrigger
        render={<Button variant="outline" className="max-w-64" aria-label={`Report: ${name}`} />}
      >
        <span className="truncate">{name}</span>
        <ChevronDownIcon />
      </ComboboxTrigger>
      <ComboboxPopup aria-label="Reports" className="w-72">
        <div className="border-b p-2">
          <ComboboxInput
            aria-label="Search reports"
            placeholder="Search reports"
            showTrigger={false}
            startAddon={<SearchIcon />}
          />
        </div>
        <ComboboxEmpty>No report matches</ComboboxEmpty>
        <ComboboxList>
          {(group: ChoiceGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              {group.value !== "" && <ComboboxGroupLabel>{group.value}</ComboboxGroupLabel>}
              <ComboboxCollection>
                {(item: Choice) => (
                  <ComboboxItem key={item.key} value={item}>
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 truncate">{item.label}</span>
                      {item.kind !== undefined && (
                        <span className="ms-auto shrink-0 text-xs text-muted-foreground">
                          {item.kind}
                        </span>
                      )}
                    </span>
                  </ComboboxItem>
                )}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
