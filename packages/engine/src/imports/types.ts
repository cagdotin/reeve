/** The import domain's contract types, as the catalog's entries give them. */
import type { OperationInput, OperationSuccess } from "../handler.ts";

export type ImportFileType = NonNullable<OperationInput<"preview_import">["fileType"]>;
export type ImportDateFormat = NonNullable<OperationInput<"preview_import">["dateFormat"]>;
export type ImportMapping = NonNullable<OperationSuccess<"preview_import">["mapping"]>;
export type ImportResult = OperationSuccess<"import_transactions">;
export type ImportStatus = ImportResult["rows"][number]["status"];
