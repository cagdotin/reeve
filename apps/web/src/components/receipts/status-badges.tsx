import type { ReceiptStatus } from "@reeve/contract/catalog";
import { Badge } from "@reeve/ui/components/badge";

const FLAGS = [
  { key: "balanced", yes: "Balanced", no: "Unbalanced" },
  { key: "matched", yes: "Matched", no: "Unmatched" },
  { key: "categorized", yes: "Categorized", no: "Uncategorized" },
  { key: "applied", yes: "Applied", no: "Not applied" },
] as const;

/** A receipt's four computed flags: a green badge for each it has, a quiet one for each it lacks. */
export function StatusBadges({ status }: { status: ReceiptStatus }) {
  return (
    <span className="flex flex-wrap gap-1">
      {FLAGS.map((flag) =>
        status[flag.key] ? (
          <Badge key={flag.key} variant="success">
            {flag.yes}
          </Badge>
        ) : (
          <Badge key={flag.key} variant="outline" className="text-muted-foreground">
            {flag.no}
          </Badge>
        ),
      )}
    </span>
  );
}
