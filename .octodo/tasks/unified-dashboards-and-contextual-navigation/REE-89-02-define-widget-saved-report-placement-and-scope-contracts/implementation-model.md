# REE-89 implementation model

Baseline inspected: `1ed0581`. This is a proposed implementation contract, not implemented behavior. It incorporates REE-87 rounds 1 and 2 and the corrected REE-88 `implementation-handoff.md`. Parent corrections take precedence over older Save-widget behavior.

## Status and evidence

Observed means read in the repository. Proposed means specified here for subsequent tasks. Verification in this task is source inspection and worked record review only. No runtime, real book, browser, or migration was exercised. No schema or handler changes belong to REE-89.

The Actual checkout is absent at the locations prescribed by the parity playbook. REE-88 also records no fresh Actual comparison. The evidence below establishes reeve's current port, not independently verified current Actual behavior. The approved departures are first-class linked built-in reports, multiple dashboard defaults, Today instead of Main for new books, and operational-page hosts. No report arithmetic changes are proposed.

## Observed inventory

| Location                                                                         | Observed model and consequence                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine/src/db/schema.ts:230`                                           | `dashboard_pages(id,name,sort_order)`, `widgets(id,page_id,type,x,y,width,height,meta)`, and `custom_reports(id,name,definition,created_at)`. `page_id` cascades on delete. No saved built-in report, default dashboard, host, or structural report reference exists.            |
| `packages/contract/src/catalog/reports.ts:498`                                   | Fourteen widget type literals. `meta` is nullable `Unknown`, including in bulk layout input. Unknown nested keys inside meta therefore are not rejected, despite the general strict-input policy.                                                                                |
| `packages/engine/src/reports/dashboard.ts`                                       | `listDashboardPages` seeds Main and 12 widgets on read. Add defaults to 4 by 2, wrapping after the last placement. Update accepts unchecked meta and grid integers. Copy clones meta. Reset replaces the widgets with the old default set. Delete refuses the last page.         |
| Same file, custom-report functions                                               | Custom report definitions are JSON, defaulted on read. Names have an exact-string application uniqueness check. Widget references are `type='custom-report', meta.id`. Delete searches that JSON and deletes linked widgets in the same operation. Tag plus Budgeted is invalid. |
| `packages/engine/src/reports/handlers.ts:44`                                     | `run_custom_report` merges supplied fields over the saved definition without saving them. `update_widgets` maps individual updates inside the runner's single transaction.                                                                                                       |
| `packages/contract/src/operation.ts:86`, `packages/engine/src/operations.ts:211` | Declared structs reject excess keys through `checkInput`, including nested structs. `Unknown` is not a strict object. Book writes get one transaction and change notification. Readonly handlers do not get an undo write transaction.                                           |
| `packages/engine/src/db/open.ts`                                                 | All three tables and settings have undo triggers. Triggers are regenerated at open. Migration runs before triggers are regenerated. Reverse SQL is stored text containing the old column names and values. A no-op handler that issues UPDATE still creates an undo record.      |
| `packages/engine/src/books.ts:80`, `packages/engine/src/book.ts`                 | `Books.handle` opens and caches the database, then advances schedules. Settings are JSON values in key/value rows, decoded through `BookSettings`. No home initialization exists.                                                                                                |
| `apps/web/src/components/reports/meta.ts`                                        | TypeScript interfaces describe metadata but `metaOf` only casts. Summary `content` contains another JSON string. Time frames have modes and month/day anchors. Conditions contain `field`, `op`, and an opaque `value`.                                                          |
| `components/reports/inputs.ts`                                                   | Existing explicit adapters translate metadata to operation inputs. They resolve defaults, normalize month/day frames, strip extra condition keys, map spending averages, and cap compact Sankey nodes. These are the migration behavior reference.                               |
| `components/reports/widget-state.ts`, `widget-card.tsx`                          | Widget routes load pages to find a widget. Save writes placement meta. Custom widget Rename changes the report name, unlike built-in Rename. Drafts use local React state, not history. These behaviors must change, not become the new contract.                                |
| `components/reports/widgets.ts`, `cards.tsx`, `lib/report-library.ts`            | Widget types map to full report paths and renderers. Markdown is not a report. Unsupported types show unavailable. The library excludes disabled purchase pages.                                                                                                                 |
| `apps/web/src/routes/index.tsx`                                                  | Fixed Home contains insight, category paces, account balances, spending pace, upcoming scheduled transactions, and recent transactions. It reads existing budget, account, spending, schedule, and transaction operations. These are not all reports.                            |
| `apps/web/src/lib/account-scope.ts`                                              | Accounts scope is all, budgeted, offbudget, or one account id. It is URL-owned and changing scope keeps the mounted page. Do not persist an arrangement per account.                                                                                                             |
| `packages/engine/test/reports.test.ts:608,685`                                   | Existing tests cover custom deletion removing its widget, Main initialization, default widgets, layout, copy, reset, and refusing last-page deletion. The Main assertions must be replaced deliberately.                                                                         |
| `docs/specs/purchases-freeze.md`, `packages/contract/src/features.ts`            | Purchases is off. Preserve historical configuration, backup data, and undo support. Do not add a feature switch or purchase queries.                                                                                                                                             |

## Proposed storage and relationships

Reuse the existing tables. Keep their physical names so this is one subsystem, not a second report or layout framework. `SavedReport` becomes the public name for a row of `custom_reports`. Built-in report types remain executable without saving a definition. Tags is a report-library tool, not a saveable report type.

### Saved report

`custom_reports` retains `id`, `name`, `created_at`, and JSON `definition`. Add nullable text `legacy_definition`, containing the exact original definition text during upgrade. It is private compatibility data, not a public input or browser payload.

The new definition is a closed discriminated union:

```ts
type SavedReport = {
  id: string;
  name: string;
  createdAt: number;
  definition: {
    version: 1;
    type: ReportType;
    settings: SettingsForThatReportType;
    scope: { accounts: Accounts };
  };
};

type Accounts =
  | { mode: "all" }
  | { mode: "budgeted" }
  | { mode: "offbudget" }
  | { mode: "selected"; ids: string[] };
```

`ReportType` is `net-worth | cash-flow | spending | summary | calendar | crossover | formula | balance-forecast | monte-carlo | custom | budget-analysis | sankey | age-of-money`. The type is immutable after creation. Save as new report creates another row. Duplicate also creates another row, with a supplied unique name and no copied placements. Names are trimmed, nonempty, and exact-case unique across all active report types. Preserve historical names verbatim on migration. Existing duplicate names remain readable but new creates and renames cannot introduce another exact trimmed match.

Definition settings retain the existing report metadata vocabulary, without `name`. This avoids rewriting all report controls and preserves saved chart choices. All listed settings are optional on create and use the existing component/input defaults. Reads return the stored settings, not defaults filled using today's date. Updates replace the entire settings object when supplied. Custom reports materialize `DEFAULT_DEFINITION()` on creation, as today. No calculated report result is stored.

| Report type         | Closed settings fields                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Most filtered types | `conditions: ReportCondition[]`, `conditionsOp: 'and'                                                                                                                                                                                                                                                                                                                                                                                                            | 'or'`. Conditions default to empty and `and`.                        |
| net-worth           | Filter fields, `timeFrame`, `interval: Daily                                                                                                                                                                                                                                                                                                                                                                                                                     | Weekly                                                               | Monthly                                                                                       | Yearly`, `mode: trend                                                                                                                                                                                                                | stacked`.                                                                                                                      |
| cash-flow           | Filter fields, `timeFrame`, `showBalance: boolean`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| spending            | Filter fields, `compare: Month`, `compareTo: Month`, `isLive: boolean`, `mode: single-month                                                                                                                                                                                                                                                                                                                                                                      | budget                                                               | average`, `averageRange: {mode:'last-n-months',months:3                                       | 6                                                                                                                                                                                                                                    | 12}                                                                                                                            | {mode:'year-to-date'} | {mode:'all-time'}`. The spending mode is display semantics, not `TimeFrameMode`. |
| summary             | Filter fields, `timeFrame`, `content: SummaryContent` as an object, not a JSON string. Fields are `type: sum                                                                                                                                                                                                                                                                                                                                                     | avgPerMonth                                                          | avgPerYear                                                                                    | avgPerTransact                                                                                                                                                                                                                       | percentage`, `divisorConditions`, `divisorConditionsOp`, `divisorAllTimeDateRange`. Move `fontSize` to placement presentation. |
| calendar            | Filter fields and `timeFrame`.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| crossover           | `expenseCategoryIds: Id[]`, `incomeAccountIds: Id[]`, `timeFrame`, `safeWithdrawalRate`, nullable `estimatedReturn`, nullable integer-cents `expectedContribution`, `projectionType: hampel                                                                                                                                                                                                                                                                      | median                                                               | mean`, `expenseAdjustmentFactor`. Retain the existing numeric bounds from `crossover_report`. |
| budget-analysis     | Filter fields, `timeFrame`, `interval`, `graphType: Line                                                                                                                                                                                                                                                                                                                                                                                                         | Bar`, `showBalance`, `balanceOnly`, `showHiddenCategories`.          |
| sankey              | Filter fields, `timeFrame`, `mode: budgeted                                                                                                                                                                                                                                                                                                                                                                                                                      | spent`, `topNcategories: positive integer`, `categorySort: per-group | global                                                                                        | budget-order`, `showPercentages`, `groupAccounts`, `showTransfers`, `layerFrom`, `layerTo`. Layers use the existing SankeyLayer enum, not arbitrary strings. Compact node clipping remains a rendering constraint, not a saved edit. |
| age-of-money        | Filter fields, `timeFrame`, `granularity: daily                                                                                                                                                                                                                                                                                                                                                                                                                  | weekly                                                               | monthly`.                                                                                     |
| balance-forecast    | Filter fields, `startDate`, `endDate`, `accounts: Id[]`, `timeFrame`, `granularity: Daily                                                                                                                                                                                                                                                                                                                                                                        | Monthly`, `yAxisBase: Zero-Based                                     | Auto`, `source: schedules                                                                     | tracking-budget`, `series: {id,name,accounts?,conditions,conditionsOp}[]`. Preserve old start/end when no frame exists.                                                                                                              |
| formula             | `formula: string`, `queries: Record<string,{conditions?,conditionsOp?,timeFrame?}>`. The query names are intentional dictionary keys. Query values are closed structs. Move `fontSize` to placement presentation.                                                                                                                                                                                                                                                |
| custom              | Exactly the existing `CustomReport` fields except `id` and `name`: `startDate,endDate,isDateStatic,dateRange,includeCurrentInterval,mode,groupBy,interval,balanceType,sortBy,showEmpty,showOffBudget,showHiddenCategories,showUncategorized,trimIntervals,showTrendLines,graphType,tagScope,conditions,conditionsOp`. Reuse existing enums and TagScope. Do not add a second custom-date model.                                                                  |
| monte-carlo         | Exactly `MonteCarloMeta` without `name`: `pots,withdrawalStrategy,returnModel,withdrawalRule,minimumSpending,spendingPhases,contributions,incomeStreams,inflationMean,inflationStdDev,taxModel,taxBands,currentAge,targetAge,simulationCount,historicalBlockLength`. Reuse corresponding nested operation schemas and existing numeric checks. Retain all inactive withdrawal-rule settings, not just the selected rule's fields. No new model of pots or taxes. |

`timeFrame` is `{start: MonthOrDay,end: MonthOrDay,mode: TimeFrameMode}` when present. Retain the current modes and anchor interpretation. Validate actual calendar days and start <= end. A missing frame uses the existing default for that report, rather than freezing six months at save time. `isLive:false` spending uses its explicit compare months. Live spending ignores old compare anchors, as `spendingInput` does now.

### Dashboard and optional page host

Add `dashboard_pages.host`, nullable text constrained to `transactions | payees`. Null means a normal dashboard. Add a partial unique index on non-null host. Existing rows keep null. Host rows reuse the widgets relationship, but are not returned as dashboards, never count toward the last-dashboard guard, cannot be the default, and cannot be renamed, duplicated, or deleted through dashboard operations.

A host has one arrangement per book, not per account, payee, URL, or device. No host row is required for an empty arrangement. Its display name is the fixed page label. The first explicit add creates the host and its first widget in the same operation. Reading an absent host returns an empty arrangement without writing. Host storage can land with REE-90; host-specific operations and constraints land with REE-100 before any embed UI.

Keep `dashboard_pages.sort_order` and expose dashboard reorder through one operation accepting all dashboard ids exactly once. Stable fallback order is `(sort_order,id)`. Host sort order is zero and irrelevant.

### Widget placement

Retain `widgets.id,page_id,type,x,y,width,height,meta`. Add `report_id` nullable text referencing `custom_reports.id` with RESTRICT, an index on it, and nullable JSON `config`. `meta` becomes private, unchanged legacy text. Do not let a schema rebuild parse or reserialize it. New rows use `meta = null`. `config` is the only active write format. No public operation accepts opaque compatibility data.

Keep existing card type literals and renderer mapping. Add five Home types: `home-insight`, `category-pace`, `account-balances`, `upcoming-transactions`, and `recent-transactions`. Spending reuses `spending-card`. Report card types require a matching report id. `summary-card` and `formula-card` remain report widgets because they already have full reports. Home summary and work-list types do not require fake report definitions.

The closed config union is selected by the widget type:

```ts
type PlacementScope = {
  accounts: { mode: "inherit" } | { mode: "fixed"; value: Accounts };
};

type Presentation = { collapsed?: boolean; fontSize?: number };

type ReportPlacementConfig = {
  version: 1;
  title: string | null;
  presentation: Presentation;
  scope: PlacementScope;
};

type LocalWidgetConfig = ReportPlacementConfig & {
  settings: LocalSettingsForThatWidgetType;
};
```

No `settings`, report filters, chart graph type, or date override belongs in report placement config. The sole initial analytical override is account scope. This prevents two apparent definitions behind one report. Widget title overrides the saved name. Null means follow the report name, then its built-in label. Rename widget always changes the placement title, including custom widgets. Rename report changes the definition row's name. Presentation accepts collapsed on every type and fontSize only on summary/formula. Font size is a finite integer from 8 through 96. No arbitrary CSS, color, component props, or JSON options bag.

Local settings are closed structs:

- `home-insight`: `{}`. Uses current month budget insight, with its existing budget and uncategorized actions.
- `category-pace`: `{limit?: integer}` default 14, range 1 through 50, current month.
- `account-balances`: `{}`. Lists current balances and net total using existing accounts logic.
- `upcoming-transactions`: `{daysAhead?: integer,limit?: integer}`, defaults 14 and 6, ranges 1 through 366 and 1 through 50.
- `recent-transactions`: `{limit?: integer}`, default 6, range 1 through 50, descending transaction date with the register's stable ordering.
- `markdown-card`: `{content?: string,text_align?: left|right|center}`. No analytical scope or report link is allowed for markdown. The common scope field is omitted for this branch.

Grid fields remain top-level placement data. Require integer `0 <= x <= 11`, `y >= 0`, `1 <= width <= 12`, `1 <= height <= 100`, and `x+width <= 12`. Overlap handling remains the current grid's responsibility. Bulk layout changes require distinct widget ids, all in one host/page, and validate the whole batch before writing. Reject invalid batches atomically. Sort cards by `(y,x,id)` on every width. Move up/down changes this same persisted order by a bulk grid update, not a second mobile order. One completed arrangement action is one undo step. Non-drag controls remain available on phones.

Operational hosts permit report cards and at most three placements. They use `x=0,width=12,height=1` and contiguous `y=0..n-1` as order, not free grid coordinates. REE-100 canonicalizes that order after add/remove/move. Embed region collapse is device-local, distinct from a widget's book-persisted collapsed presentation.

## Proposed operations and ownership

Inputs below are flat operation structs and include optional `book`. Results omit private legacy text. Add definitions in the catalog and regenerate routes and skill. No hand-written HTTP, MCP, or CLI endpoints. Keep current report execution operations and explicit input adapters. Do not introduce a generic execution engine or polymorphic result endpoint.

| Operation                                        | Input and semantics                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_saved_reports`                             | `{}` returns all available SavedReport rows sorted by name then id. No usage lookup required for every list item.                                                                                                                                                                                                                                                          |
| `get_saved_report`                               | `{id}` returns one available definition.                                                                                                                                                                                                                                                                                                                                   |
| `create_saved_report`                            | `{name,definition}` creates the closed union. `definition.version=1`. No placement side effects.                                                                                                                                                                                                                                                                           |
| `update_saved_report`                            | `{id,name?,settings?,scope?}` replaces each supplied whole object, not a deep merge. Validate settings against the existing report type. Explicit Save only. It never accepts placement id as the target.                                                                                                                                                                  |
| `duplicate_saved_report`                         | `{id,name}` copies definition and creates a new id and timestamp. No placements.                                                                                                                                                                                                                                                                                           |
| `get_saved_report_usage`                         | `{id}` returns `{reportId,placements:[{id,pageId,host:null                                                                                                                                                                                                                                                                                                                 | 'transactions'                                                                                                                                                                                                                                                                                                      | 'payees',pageName,title}]}` sorted by page and placement. Includes every live structural reference, not just currently mounted widgets. |
| `delete_saved_report`                            | `{id,expectedPlacementIds: Id[]}` requires the exact sorted-set-equivalent current usage, including empty. Mismatch is InvalidRequest with instruction to review usage again. After disclosure and confirmation, explicitly delete placements, then report, in one runner transaction. One undo restores report before placements. No orphan cleanup in a later operation. |
| `list_dashboard_pages`                           | Existing result extended with `isDefault:boolean`; pure read, dashboard rows only.                                                                                                                                                                                                                                                                                         |
| `set_default_dashboard`                          | `{id}` validates a normal dashboard and changes the book setting only.                                                                                                                                                                                                                                                                                                     |
| `reorder_dashboard_pages`                        | `{ids:Id[]}` contains every normal dashboard exactly once. One undoable batch.                                                                                                                                                                                                                                                                                             |
| `create_dashboard_page`, `rename_dashboard_page` | Existing inputs. Create empty. Trim and reject blank names. Duplicate names are allowed, ids identify dashboards.                                                                                                                                                                                                                                                          |
| `duplicate_dashboard_page`                       | `{id,name}` clones placements in one transaction. Report ids remain linked. Local settings and presentation are copied. It does not change the default.                                                                                                                                                                                                                    |
| `delete_dashboard_page`                          | Existing `{id}`. Reject last normal dashboard. Explicitly remove its placements, retain reports. If default, select first remaining `(sort_order,id)` and change setting in the same undo step.                                                                                                                                                                            |
| `reset_dashboard_page`                           | Existing `{id}`. Reset placements to the Today template, not Actual's legacy template. Do not rename page or change default. Create only the template's required saved report definitions, never delete unrelated or now-unused reports. One undo. Warn about removed placements before UI confirmation.                                                                   |
| `add_widget`                                     | Existing `{pageId,type,x?,y?,width?,height?}` plus `reportId?` and `config`. Require a report id for a report card. Defaults are 4 by 2 and append on the dashboard. Local widgets forbid reportId. No inline report creation hidden in this operation.                                                                                                                    |
| `update_widget`                                  | `{id,x?,y?,width?,height?,config?}`. Supplied config replaces the full typed placement config. Neither reportId nor type can change. Changing linked definition calls update_saved_report instead.                                                                                                                                                                         |
| `update_widgets`                                 | `{widgets:[{id,x?,y?,width?,height?}]}` only. Remove meta from layout writes. Atomic batch validation and no-op detection.                                                                                                                                                                                                                                                 |
| `copy_widget`                                    | Existing `{id,pageId}`. Fresh placement id, same linked report id, copied config.                                                                                                                                                                                                                                                                                          |
| `remove_widget`                                  | Existing `{id}`. Deletes placement only.                                                                                                                                                                                                                                                                                                                                   |
| `repair_widget`                                  | `{id,type,reportId?,config}`. Only unavailable, non-frozen placements qualify. Replace active type/link/config after normal validation, retain private meta and layout, and record one undo step. Normal placements cannot use repair to bypass immutable type/link rules.                                                                                                 |
| REE-100 host operations                          | `get_page_widgets {host}` returns `{host,pageId:Id                                                                                                                                                                                                                                                                                                                         | null,widgets}`. `add_page_widget {host,type,reportId,config}`creates host if absent and appends.`reorder_page_widgets {host,ids}` accepts exact current ids. Existing update/remove handle canonicalized host placements with constraints. No arbitrary host identifiers or free layout fields accepted for embeds. |

All writes compare canonical stored values before UPDATE. Repeating an identical set, rename, config, or layout update changes nothing, emits no undo SQL, and does not clear redo. Create, copy, duplicate, and reset are not declared idempotent. Reference validation is in the same transaction as the write. Return NotFound for a missing report, widget, or page. Return InvalidRequest for wrong report type, invalid host, or invalid settings. The update settings input uses a union of the closed settings schemas, followed by validation against the stored type in the handler. It is not Unknown.

Keep `list/create/update/delete_custom_report` and `run_custom_report` as thin compatibility adapters on the same rows for existing clients. They filter and require `definition.type='custom'`, unwrap settings on output, and map flat custom fields to the new operations' handler functions, never invoke a nested runner transaction. Legacy custom delete accepts optional `expectedPlacementIds` initially. An in-use report without it fails with InvalidRequest asking the caller to disclose usage. Empty usage remains deletable with the old input. New public UI uses unified operations. No second custom report implementation.

For one transition, legacy `add_widget` and `update_widget` may accept the existing `meta` input instead of config, never together. Dispatch to a closed schema for the known widget type before writing. Reject unknown nested keys. For legacy built-in add, normalize the old settings into a fresh saved report plus placement in that same undoable write. For legacy custom add, resolve meta.id. For legacy built-in meta update, map report fields to the linked definition and name/font fields to placement; the old report-page Save therefore updates the definition, not a hidden local copy. Repeating the same input must be a no-op. Mark this compatibility path for removal when REE-91 migrates all report controls. Never accept Unknown as a public meta write escape hatch.

REE-90 keeps current dashboard renderers working through a read-only legacy `Widget.meta` projection from definition plus placement. Public Widget adds `reportId`, `config`, and `availability`, but retains projected meta until REE-91 migrates consumers. Project SummaryContent back to its old JSON string for those consumers. Private original meta is never the projection. Read compatibility is not a second writable source of truth.

## Proposed preference ownership

| Owner                         | Fields                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Book, undoable                | Dashboard name/order/default id, report definitions, placement title/layout/presentation/scope, local widget settings, optional page arrangements.                        |
| Device through `lib/prefs.ts` | Existing sidebar and pane-width preferences, plus `reeve:embeds-collapsed:<book>:<host>`. An absent phone embed-collapse preference means collapsed.                      |
| Window session, per book      | Last dashboard id, last report href, scroll positions by history key, and open pane. Clear on book switch. Do not persist launch resume.                                  |
| URL/history entry             | Report identity and validated exploration snapshot. Back/Forward and reload retain it without writing the book. Definition-editor drafts remain guarded local form state. |
| Internal lifecycle metadata   | `homeInitializedVersion` is not editable or undoable through public operations. `defaultDashboardId` is public book data and ordinary changes are undoable.               |

Ordinary launch at `/` opens the book default, while Home during the session returns to the last dashboard. Explicit deep links retain their target. Do not store one arrangement or default per account or device.

Closed schemas live in `packages/contract/src/catalog/reports.ts` and the existing projection schemas. Browser modules import their types only. Keep normalization and scope resolution browser-safe and use the existing allowed client/rules/features imports. Do not introduce a runtime root-contract or engine import to share Effect schemas with the web bundle. Pure browser scope tests can use type-only fixtures without a new runtime package export.

## Proposed scope and exploration

Account scope is a constraint outside the report's condition group. A condition group with OR must not turn scope into another OR alternative. Effective records satisfy `selected account scope AND (saved conditions combined by conditionsOp)`. Forecast series accounts and crossover income accounts further intersect scope, never widen it. Monte Carlo pot account links are economic plan inputs, not viewing filters.

Scope precedence, highest to lowest:

1. A serializable temporary exploration account choice in the current full-report history entry.
2. The placement's explicit fixed account override.
3. For inherit on Transactions or Payees, the current host account scope.
4. For inherit on a dashboard, or a report opened directly, the saved report's scope.
5. Built-in default `{mode:'all'}` when no saved definition exists.

A local widget inherits host scope if any, otherwise all. Book summary widgets tied to budget arithmetic (`home-insight`, `category-pace`) are budget-wide and cannot accept fixed scopes or operational-page placement. Their UI labels them Budget-wide rather than pretending to respect an account filter. Markdown has no scope. Monte Carlo is also plan-wide and cannot accept fixed or embedded account scope. REE-100 permits only types whose existing report query can honor scope without changing accounting semantics. Initially allow net-worth, cash-flow, spending, summary, calendar, custom, balance-forecast, age-of-money. Budgeted custom reports, budgeted Sankey, and budget-analysis remain budget-wide. Reject scope overrides rather than silently ignoring them. Crossover and formula remain dashboard-only initially because named plan accounts and formula references do not have a general safe account-scope mapping.

Dates come from the saved settings' existing date representation, resolved at query time. The host contributes no date filter by default. A register's date/search/payee/category filters do not silently become widget scope. Temporary report exploration can replace the report's time frame or spending/custom date fields, and filters, without writing the definition. There is no persisted placement date override in this version. REE-101 can display a scoped account label without claiming the chart is filtered by the table's text search.

`Accounts.selected.ids` must be nonempty and distinct. It includes asset and liability accounts only, including closed accounts for historical reports. Validate new writes against live book ids. An existing stored scope whose account is later deleted resolves to the remaining selected accounts. If none remain, show no matching records and an unavailable-scope message, never all accounts. A temporary empty intersection likewise returns zero records. Do not send an empty accounts array to an existing report operation that interprets it as all. Short-circuit its empty-result rendering or add an explicit account predicate in the existing query adapter.

### Full-report opening and explicit saving

An Open report link carries `report=<id>`, `widget=<placementId>`, and a versioned exploration snapshot of the effective settings and accounts. The route type must match the report type. Preserve `custom?id=<id>` as an alias. Built-ins without a saved definition have no report id and offer Save as new report. A placement id is provenance, never the identity of the report being edited.

Proposed history value is `{version:1,reportId?:Id,type:ReportType,settings:SettingsForThatReportType,accounts:Accounts}`. Encode the snapshot in a validated URL search value `explore`, including explicit dates resolved when opened from a widget. REE-95 owns serialization limits and navigation integration. It must preserve the snapshot on Back, Forward, and reload, not recreate it from a possibly changed placement. Picking another report discards unrelated search and opens that report's own defaults. History-entry scroll and pane state follow REE-88. No history operation calls a write.

Edit saved report starts from the definition, not the overlaid exploration or fixed placement scope. Save replaces the definition explicitly and discloses its linked usage. Saving exploration to the existing report is a separate explicit confirmation that shows what fields and scope will change. Save as new report copies the explored settings and account scope to a new definition, leaving all old placements linked to the old definition. Widget settings edits only title, presentation, layout, and the allowed account override. A fixed embedded scope gets a visible label in the widget and in the full-report origin context.

A supported segment opens contributing record criteria `{accounts,start:Day,end:Day,conditions,conditionsOp,segment}` in the one pane. The segment is a closed union implemented per supported report, not arbitrary SQL or a stored query framework. Account scope and segment predicates are AND constraints outside the saved OR group. REE-97 must reconcile totals and translate split/category/transfer semantics through existing report lines and register operations. Projections and budget allocations must not fabricate contributing transaction lists. Unsupported segment drill-down is absent, not an approximate register link.

## Proposed migration mapping

Use a new generated migration plus a versioned data backfill at open. Preserve ids, names, created timestamps, page sort order, widget ids, and all grid coordinates. Preserve exact original JSON text privately, including unknown keys. No financial or purchase rows change.

| Old record                                                                                                                                                      | New active record                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `custom_reports r1`, definition `D`                                                                                                                             | Same row and name, `legacy_definition` is exact D. New definition `{version:1,type:'custom',settings:known fields of D,scope:{accounts:{mode:'all'}}}`. Fill missing custom fields with the existing defaults once. Unknown fields remain only in the archive.                               |
| `widgets w1`, `custom-report`, meta `{id:'r1',name:'Short title',future:{a:1}}`                                                                                 | Same placement and layout, `report_id='r1'`, config title `Short title`, default presentation and inherit scope. Exact meta remains private. All placements naming r1 share one report. A missing name means null title.                                                                     |
| `widgets w2`, `net-worth-card`, meta `{name:'Savings',timeFrame:{start:'2024-01',end:'2024-12',mode:'yearToDate'},interval:'Monthly',mode:'stacked',future:42}` | Create one saved net-worth report with these known analytical settings, scope all, and name Savings if unused. Link w2, title Savings, default presentation and inherit scope. Do not resolve YTD to static dates. Preserve future:42 in private meta.                                       |
| Another identical old built-in widget                                                                                                                           | Create another independent definition. Old built-in widgets were independent. Do not deduplicate by settings, title, or hash and accidentally link existing customizations. Future copy operations link by default.                                                                          |
| Summary meta with `content:'{"type":"percentage","fontSize":32,"divisorConditions":[],"future":1}'`                                                             | Parse known fields to object SummaryContent in the saved summary definition, move fontSize to config.presentation, preserve the exact nested string in private meta. Never keep a new string-encoded settings object.                                                                        |
| `markdown-card`, meta `{content:'Notes',text_align:'center',future:true}`                                                                                       | No report. Config local settings content and alignment, null title, presentation defaults. Preserve all original meta privately.                                                                                                                                                             |
| `custom-report`, meta.id missing or dangling                                                                                                                    | Preserve raw placement and mark unavailable missing-reference. Do not invent an empty custom report or delete it on read. Its active report_id stays null. It may be removed, copied as unavailable, or repaired through `repair_widget` by explicitly choosing an existing matching report. |
| Unknown type, malformed meta, or unsupported definition version                                                                                                 | Preserve the raw row and metadata unchanged. Return an unavailable placement descriptor, no report query and no invented definition. Layout/remove/copy remain possible. A repair replaces only active config and link after explicit validation.                                            |
| Purchases-only type or metadata identifying disabled purchase content                                                                                           | Preserve all original rows and text, do not migrate into active definitions, do not expose a library entry, widget, title, query, or configuration action. Hidden rows still occupy their stored layout positions. No compact/reflow write may erase or normalize them.                      |

Migration-created report names use the old nonblank widget name, otherwise the built-in label. On collision append ` (2)`, ` (3)`, choosing the first unused exact trimmed name in widget-id order. Use fresh stored ids and a single migration timestamp. The entire backfill and marker commit together, so a retry after rollback allocates no visible duplicate. Do not use display names as migration identities. Archived JSON is output-only internal compatibility data, not a route for users to supply unknown keys.

Malformed legacy values must not prevent opening a financial book. Migrate a record only if the recognized fields validate. Otherwise keep it unavailable with its original text. Frozen purchase checks run before interpretation. Do not infer an active type from purchase metadata merely because its widget type happens to be recognized. Capability checks must also cover restored legacy records and saved-report listing, not only the add menu.

### Initialization, migrations, and undo

Initialization is an explicit engine lifecycle function called by `Books.handle` after database open and before schedule advancement. It runs in one immediate transaction with undo recording off, not in list_dashboard_pages. Store internal `homeInitializedVersion=1` and `defaultDashboardId` in settings. Add only `defaultDashboardId` to public BookSettings output. The internal version key is not a public update input. Use `set_default_dashboard`, not update_book, for relational validation.

If the version is absent, backfill old reports and placements, then add a fresh ordinary Today dashboard, even if someone already has an unrelated dashboard named Today. New books have only this Today. Existing books keep every old dashboard and receive Today as default. Set the version last. Initialization must not mistake a renamed dashboard for an uninitialized book. On repeat open, read-only list, deleted Today, renamed Today, reset, or deleted seeded reports, do not seed again. Invalid default references fall back deterministically for display with an info alert, not a write on read. Explicit deletion always updates the setting correctly. A missing internal marker is an upgrade condition, not a general user-repair API.

Today template version 1 contains six placements: home-insight `(0,0,6,3)`, category-pace `(6,0,6,3)`, account-balances `(0,3,6,3)`, spending-card `(6,3,6,3)`, upcoming-transactions `(0,6,6,3)`, recent-transactions `(6,6,6,3)`. Local settings use defaults above. Spending links a new saved Spending report with `{isLive:true,mode:'single-month'}` and all-account scope. No embedded hosts or purchase widgets are seeded. Today is not locked or distinguished after initialization. REE-90 persists the model and template; REE-91/92 render its types; REE-93 exposes unified editable Home. Do not remove the current Home route before those renderers work. Interim unimplemented Home renderers use the existing unavailable-card behavior, not fake empty financial figures.

User approval and [reports rules](../../../../docs/rules/reports.md) supersede the historical replay requirement. Clear pre-upgrade undo and redo once in the same transaction as conversion and initialization. A failed upgrade preserves the original history and rows through rollback. Do not implement historical reconciliation or replace the undo engine. Normal post-upgrade undo/redo remains required. Back up the development books before applying the upgrade.

After upgrade, settings, reports, hosts, placements, and private compatibility columns remain covered by the existing undo triggers. Seed is a lifecycle baseline, not an undo step. Report delete records placement deletes before the report delete, so reverse order restores the report first. Dashboard delete records widgets, page, then default setting, allowing reverse order to restore the old setting and page in one transaction. SQLite checks final relational consistency at transaction boundaries where necessary. Verify FK ordering rather than relying on cascade trigger order. Reset and duplicate explicitly write their complete object changes under one runner transaction. Backups and restore preserve private columns and hidden rows without interpreting them. No new non-undo table is necessary.

## Worked proposed records

### Existing report converted from a widget

```json
{
  "id": "r-net",
  "name": "Savings",
  "createdAt": 1794045600000,
  "definition": {
    "version": 1,
    "type": "net-worth",
    "settings": {
      "timeFrame": { "start": "2024-01", "end": "2024-12", "mode": "yearToDate" },
      "interval": "Monthly",
      "mode": "stacked"
    },
    "scope": { "accounts": { "mode": "all" } }
  }
}
```

Two placements link that same definition. The second uses a fixed scope and a different title. Neither contains another copy of its settings.

```json
[
  {
    "id": "w-net",
    "pageId": "today",
    "type": "net-worth-card",
    "reportId": "r-net",
    "x": 0,
    "y": 0,
    "width": 6,
    "height": 3,
    "config": {
      "version": 1,
      "title": null,
      "presentation": {},
      "scope": { "accounts": { "mode": "inherit" } }
    }
  },
  {
    "id": "w-net-2",
    "pageId": "planning",
    "type": "net-worth-card",
    "reportId": "r-net",
    "x": 6,
    "y": 0,
    "width": 6,
    "height": 3,
    "config": {
      "version": 1,
      "title": "Checking trend",
      "presentation": { "collapsed": false },
      "scope": {
        "accounts": { "mode": "fixed", "value": { "mode": "selected", "ids": ["checking"] } }
      }
    }
  }
]
```

Saving r-net's interval as Weekly changes both charts. Renaming r-net changes only the first displayed title. Resizing w-net-2 changes neither r-net nor w-net. Removing either placement leaves r-net available in Reports.

### Work-list widget

```json
{
  "id": "w-recent",
  "pageId": "today",
  "type": "recent-transactions",
  "reportId": null,
  "x": 6,
  "y": 6,
  "width": 6,
  "height": 3,
  "config": {
    "version": 1,
    "title": "Recent activity",
    "presentation": {},
    "scope": { "accounts": { "mode": "inherit" } },
    "settings": { "limit": 6 }
  }
}
```

This invokes the existing transaction query, opens a record task, and has no Open report or Edit saved report action.

### Inherited embedded scope

A Transactions host has a placement linked to a cash-flow report whose saved scope is all. Its config is `{version:1,title:null,presentation:{},scope:{accounts:{mode:'inherit'}}}`. The page scope is checking, so the widget uses `{mode:'selected',ids:['checking']}`. Changing the mounted page to offbudget recomputes the chart under offbudget without changing either stored row. Register text search and date filters do not alter it.

Open report freezes that current effective scope and resolved date range into exploration. Switching the underlying page later cannot mutate that history entry. Edit saved report still edits the all-account definition. Replacing inherit with `{mode:'fixed',value:{mode:'budgeted'}}` makes the widget independent of page account changes and displays a Budget accounts · Fixed label. No account-specific arrangement is created.

## Boundary validation and unavailable data

- New version, report type, widget type, mode, host, layer, and enum values are closed. Reject unknown keys in definition, settings, config, scope, account selectors, presentation, series, summary content, formula query values, tagScope, and every Monte Carlo nested object. Use Effect structs with `INPUT_PARSE_OPTIONS`, not `Schema.Unknown` at these boundaries.
- Existing ReportCondition.value is currently Unknown. For new persisted settings validate value by the existing field/operator semantics: scalar string/id, finite number or integer money, boolean, an array of corresponding scalars, or the existing closed isbetween range {num1,num2}. Reject arbitrary object operands and bad operator/value combinations. Apply the same check to formula queries, summary divisors, and forecast series. Do not widen rule schemas or redesign rule execution in this task.
- Omitted optional object means unchanged on update. Supplied object means replacement. Null is only accepted where declared, including title, nullable simulation settings, and legacy archives internally. Null config, unknown versions, and cross-type settings are InvalidRequest. JSON parsing failures in new inputs are InvalidRequest, never a fallback to a sum or all accounts.
- New dangling report, dashboard, account, or category references fail before writes. Existing dangling refs remain readable as unavailable. No automatic deletion on read, query refetch, or navigation. Unsupported descriptors are output-only `{id,pageId,type:string,layout,availability:'missing-reference'|'unsupported'|'invalid-config'}`. Their private data is not returned as a write template. Repair is explicit through `repair_widget` with a matching validated config and report selection, not manual SQL. Invalid or unsupported saved definitions use an output-only `{id,name,createdAt,availability:'unsupported'|'invalid-config'}` descriptor without executable settings. Listing them never defaults malformed data into an active report.
- Capability-disabled rows are omitted from public active lists and are never queried. They remain in storage and backup. Dashboard duplication copies their raw rows internally without exposing purchase actions. Reset removes active placements only and preserves hidden disabled rows. Delete of the containing dashboard is an explicit structural deletion and is fully undoable, including hidden rows and private text. Usage disclosure must not leak a hidden purchase title.
- A missing widget on an old URL leaves the report usable from its report id or exploration snapshot and shows the REE-88 info alert. Without either, use that built-in's defaults and offer Save as new report. A missing saved report without a snapshot is NotFound, not another report with the same name. With a snapshot it can remain an unsaved exploration and offers only Save as new report. No silent relinking.

## REE-90 implementation sequence and exact acceptance cases

REE-90 owns schema, backfill, initialization, operation schemas/handlers, generated outputs, and engine fixtures. It does not own navigation, report history, charts, pane layout, drag UI, phone screenshots, or optional-host UI. Contract tests alone cannot prove persistence. All behavior tests use scratch homes and operations. Old-format fixture setup may write old schema rows before opening with the upgraded engine.

1. Add closed schemas and migration fixture cases first. Extend the existing tables, generate migrations, implement atomic backfill and lifecycle initialization, then operations. Keep legacy read projections and adapters until their callers migrate. Generate catalog outputs. Parent records the decisions with this change.
2. **New book baseline:** create a fresh scratch book. Before any dashboard read, lifecycle initialization has produced exactly Today, its six placements, one saved spending report, and a valid default id. No Main or page hosts. List twice, close/reopen twice, and compare rows and undo counts unchanged.
3. **Upgrade preservation:** fixture has Main id p1, Work id p2, arbitrary sort orders and layouts, a custom report r1 and two custom widgets referencing it, a built-in widget with extra nested meta keys, a summary with nested content JSON, and markdown. Open upgraded book. All old ids, names, positions, timestamps, and exact archived text match. One new Today is default. Both custom placements link r1. Old built-ins each have distinct report ids, even with identical meta. Repeat open produces no additional rows.
4. **Existing Today name:** fixture already has a customized dashboard named Today. Upgrade preserves it and creates exactly one separate seeded Today by id. Rename the seeded Today, delete it when another dashboard exists, then reopen. It is not recreated and the explicit replacement default remains.
5. **Crash/rollback:** force backfill failure after report insertion but before marker commit in a scratch fixture. Reopen after removing fault. Exactly one successful conversion and one Today exist. Original rows and pre-upgrade undo history survived the failed transaction.
6. **Development history boundary:** seed both pre-upgrade history stacks. Successful upgrade clears both once. Failed upgrade preserves both. Subsequent operations support ordinary undo and redo, including after reopen. Financial and frozen purchase records remain unchanged by the upgrade.
7. **First-class built-in:** create a saved net-worth definition, get and list it, reopen and get it unchanged, then duplicate with a new name. Duplicate id differs and has zero usage. Execute existing net_worth_report using the known-field adapter and compare with the same unsaved input. Do not change arithmetic.
8. **Linked placements:** create two placements on different dashboards for one report. Update its settings through update_saved_report. Both resolve the new settings and usage returns both page names and ids. Edit the second title, fixed scope, size, and collapse state. The first placement and report bytes are unchanged. Copy a placement and duplicate a dashboard. Both new placements keep the same report id. Duplicate report stays independent.
9. **Deletion disclosure:** get usage containing three placement ids. Attempt delete with missing, extra, and stale ids. Each is InvalidRequest with zero writes. Confirm exact set. Definition and all placements disappear in one undo group. One undo restores ids, definitions, config, raw archives, and every placement. One redo removes them. Remove one widget separately and verify report remains.
10. **Default and page guards:** set default p2, delete p2, and check default is first remaining normal dashboard. One undo restores p2, widgets, and original default. An empty Transactions host does not permit deleting the last normal dashboard. Host ids cannot become default or pass dashboard rename/delete/reset.
11. **Reset and duplication:** customize Today, reset it, and verify six active template placements, unchanged name and default, hidden rows retained, and no unrelated report deletion. One undo restores the exact old arrangement and removes reset-created definitions. Repeat reset is a new explicit action, not initialization. Duplicate copies hidden rows and archives internally without exposing them.
12. **Unknown keys:** operation inputs fail for `definition.extra`, `definition.settings.timeFrame.extra`, `config.extra`, `config.scope.accounts.value.extra`, `config.presentation.css`, `settings.series[0].extra`, `settings.queries.q.extra`, `settings.content.extra`, `settings.tagScope.extra`, and `settings.pots[0].investmentPhases[0].extra`. Also reject object-valued ReportCondition.value with an unknown nested key. Exercise representative cases through engine, HTTP, and MCP schemas. Assert InvalidRequest and no row or undo change.
13. **Invalid relationships and shapes:** reject missing page/report/account ids, wrong report/card combination, local widget with reportId, report widget without reportId, malformed summary JSON on compatibility input, negative coordinates, width 13, x+width 13, height zero, invalid calendar dates, reversed frames, duplicate bulk ids, mixed-page bulk updates, invalid forecast series, and Tag plus Budgeted custom report. A batch whose final member is invalid rolls back all earlier members.
14. **No-op preserves redo:** move a widget, undo it, submit the restored identical config and layout, then redo. Redo remains available. Repeat set_default and rename with existing values. No additional undo step. A read or initialization rerun is never a write step.
15. **Scope cases:** selected checking plus saved OR(payee A,payee B) matches only checking, not another account with payee A. Fixed budgeted wins over an offbudget page. Inherit resolves checking then offbudget without persisted mutations. Direct report uses its own saved scope. Empty account intersection gives no rows, not all. Budget-wide types reject fixed/embedded scope. Pure resolution tests may land in REE-90; actual host UI and history belong to REE-100/101 and REE-95.
16. **Unavailable and frozen:** fixture has a dangling custom widget, an unknown type, malformed meta, disabled purchase metadata, and a disabled purchase type. Upgrade and all reads succeed without purchase queries. Public lists omit disabled rows and cannot expose their raw text. Unknown/dangling active rows show unavailable. Active layout saves, reset, backup/restore, and undo/redo preserve the disabled rows' exact metadata unless their containing dashboard is explicitly deleted and then undo restores it.
17. **Compatibility:** existing custom CRUD still reads the same id and settings through unified storage. An old built-in add meta creates report plus placement in one undo step. Old Save meta updates that linked definition. New config plus legacy meta together fails. Old delete of an in-use custom report requires reviewed usage. CLI and generated HTTP/MCP discovery expose unified saved-report operations without purchase operations. Run representative changed CLI writes and HTTP reads against scratch homes.

REE-91 verifies settings versus definition actions and usage disclosure in the UI. REE-93 verifies Today editing and phone Move up/down. REE-95 verifies exploration after Back/Forward/reload with no persistence writes. REE-97 verifies contributing-record sums. REE-100/101 verify optional-host limits, fixed labels, inherited scope, and dense phone layouts. REE-103 runs the integrated release checks. These are not claimed by REE-89 or REE-90.

## Parent-owned documentation and readiness

Parent records the linked saved-report model and departures, default/Today lifecycle, scope precedence, and placement/exploration ownership before persistence lands. User approval recorded in [reports rules](../../../../docs/rules/reports.md) supersedes the original historical undo/redo requirement. REE-90 implements a transactional one-time history reset and verifies subsequent undo/redo. Update architecture descriptions for the extended tables and lifecycle initialization, BookSettings for the default id, and AGENTS.md's dashboard/report terminology when implementation changes it. Preserve the Purchases freeze specification. REE-88's width, route, and pane recommendations are not reopened here.

The model gate is met by this attachment and source inspection: objects, fields, migration samples, write ownership, strict-input requirements, lifecycle, deletion, scope, and acceptance cases are specified. No runtime implementation is complete. [reports rules](../../../../docs/rules/reports.md) authorizes the disclosed one-time history reset. Scratch fixtures prove the upgrade. Applying it to the development books requires the user-authorized backup.
