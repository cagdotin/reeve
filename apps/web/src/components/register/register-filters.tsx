import type { Account } from "@reeve/contract";
import { useQuery } from "@tanstack/react-query";
import { TableFilterActions, TableSearch } from "@/components/table-controls";
import { Facets } from "@/components/facets";
import { FilterChip } from "@/components/insights/filter-bar";
import { bookQuery } from "@/lib/api";
import { useBook } from "@/lib/book";
import type { FacetValue } from "@/lib/facets";
import { monthLabel } from "@/lib/months";
import { CHECKS, type Check, filterGroups } from "@/lib/register";

/** The register's search and filters; `accounts` are the ones to offer in a view of several. */
export function RegisterFilters({
  accounts,
  query,
  onQuery,
  value,
  onChange,
  month,
  onClearMonth,
  check,
  onClearCheck,
}: {
  accounts: ReadonlyArray<Account> | undefined;
  query: string;
  onQuery: (query: string) => void;
  value: FacetValue;
  onChange: (value: FacetValue) => void;
  month: string | undefined;
  onClearMonth: () => void;
  check: Check | undefined;
  onClearCheck: () => void;
}) {
  const { id: book } = useBook();
  const categories = useQuery(bookQuery(book, "list_categories", {})).data ?? [];
  return (
    <>
      <TableSearch label="Search transactions" value={query} onValueChange={onQuery} />
      <TableFilterActions>
        <Facets
          groups={filterGroups(accounts, categories)}
          value={value}
          onValueChange={onChange}
        />
        {value["payees"] !== undefined && (
          <FilterChip
            label={value["payees"].length === 1 ? "One payee" : `${value["payees"].length} payees`}
            clearLabel="Remove the Payee filter"
            onClear={() => {
              const { payees: _, ...rest } = value;
              onChange(rest);
            }}
          />
        )}
        {month !== undefined && (
          <FilterChip
            label={monthLabel(month)}
            clearLabel={`Clear ${monthLabel(month)}`}
            onClear={onClearMonth}
          />
        )}
        {check !== undefined && (
          <FilterChip
            label={CHECKS[check]}
            clearLabel={`Stop showing only: ${CHECKS[check]}`}
            onClear={onClearCheck}
          />
        )}
      </TableFilterActions>
    </>
  );
}
