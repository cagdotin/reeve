import { Books, runOperation } from "@reeve/engine";
import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

/** The path of a receipt photo's bytes; `get_receipt_photo` names the same photo as JSON. */
export const RECEIPT_PHOTO_PATH = "/api/books/:book/receipt-photos/:id/file";

const STATUS: Readonly<Record<string, number>> = {
  BookNotFound: 404,
  NotFound: 404,
  InvalidRequest: 400,
};

const failure = (error: unknown) => {
  const tag =
    typeof error === "object" && error !== null && "_tag" in error
      ? String(error._tag)
      : "StorageError";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : String(error);
  return HttpServerResponse.jsonUnsafe({ _tag: tag, message }, { status: STATUS[tag] ?? 500 });
};

/**
 * Streams a receipt photo's file with its content type, for `<img src>` in the web app: the one
 * route that answers with bytes rather than an operation's JSON (docs/rules/purchases.md).
 */
export const receiptPhotoRoute = HttpRouter.add(
  "GET",
  RECEIPT_PHOTO_PATH,
  Effect.gen(function* () {
    const { book, id } = yield* HttpRouter.params;
    const books = yield* Books;
    const photo = (yield* runOperation("get_receipt_photo", { book, id }).pipe(
      Effect.provideService(Books, books),
    )) as { readonly path: string; readonly mimeType: string; readonly exists: boolean };
    if (!photo.exists)
      return failure({ _tag: "NotFound", message: `The file ${photo.path} is missing` });
    return yield* HttpServerResponse.file(photo.path, {
      contentType: photo.mimeType,
      headers: { "cache-control": "private, max-age=31536000, immutable" },
    });
  }).pipe(Effect.catch((error) => Effect.succeed(failure(error)))),
);
