import type { Receipt, ReceiptPhoto } from "@reeve/contract/catalog";
import { FileTextIcon, ImagePlusIcon, Trash2Icon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@reeve/ui/components/button";
import { Dialog, DialogPopup, DialogTitle } from "@reeve/ui/components/dialog";
import { ScrollArea } from "@reeve/ui/components/scroll-area";
import { cn } from "@reeve/ui/lib/utils";
import { useBookMutation } from "@/lib/api";
import { useBook } from "@/lib/book";
import { photoUrl } from "@/lib/receipts";

/** A file's bytes as base64, without the data URL's prefix. */
const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result).replace(/^[^,]*,/, "")));
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Can't read the file")),
    );
    reader.readAsDataURL(file);
  });

const isImage = (photo: ReceiptPhoto) => photo.mimeType.startsWith("image/");

/** The receipt's photos: the first one large, the rest as thumbnails; add, zoom and delete. */
export function Photos({ receipt }: { receipt: Receipt }) {
  const { id: book } = useBook();
  const attach = useBookMutation(book, "attach_receipt_photo");
  const remove = useBookMutation(book, "delete_receipt_photo");
  const input = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(0);
  const [zoomed, setZoomed] = useState<ReceiptPhoto | null>(null);
  const photo = receipt.photos[Math.min(shown, receipt.photos.length - 1)];

  const add = async (files: FileList | null) => {
    const picked = [...(files ?? [])];
    const contents = await Promise.all(picked.map(base64));
    picked.forEach((file, index) =>
      attach.mutate({
        receipt: receipt.id,
        content: contents[index]!,
        fileName: file.name,
        ...(file.type === "" ? {} : { mimeType: file.type }),
      }),
    );
  };

  const addInput = (
    <input
      ref={input}
      type="file"
      accept="image/*,application/pdf"
      multiple
      hidden
      aria-label="Photo file"
      onChange={(event) => {
        void add(event.target.files);
        event.target.value = "";
      }}
    />
  );

  if (photo === undefined)
    return (
      <div className="flex items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
        <span className="flex-1">No photo of this receipt.</span>
        <Button variant="ghost" loading={attach.isPending} onClick={() => input.current?.click()}>
          <ImagePlusIcon />
          Add photo
        </Button>
        {addInput}
      </div>
    );

  return (
    <section aria-label="Photo" className="grid gap-2 rounded-xl border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[13px] font-medium">
          {receipt.photos.length === 1 ? "Photo" : `${receipt.photos.length} photos`}
        </span>
        <Button variant="ghost" loading={attach.isPending} onClick={() => input.current?.click()}>
          <ImagePlusIcon />
          Add photo
        </Button>
        {addInput}
      </div>
      <div className="group/photo relative overflow-hidden rounded-lg border bg-muted/30">
        {isImage(photo) && photo.exists ? (
          <button
            type="button"
            className="block w-full cursor-zoom-in"
            onClick={() => setZoomed(photo)}
          >
            <img
              src={photoUrl(book, photo.id)}
              alt={photo.fileName}
              className="max-h-[calc(100svh-11rem)] w-full object-contain @max-5xl:max-h-[45svh]"
            />
          </button>
        ) : (
          <a
            href={photoUrl(book, photo.id)}
            target="_blank"
            rel="noreferrer"
            className="flex h-32 flex-col items-center justify-center gap-2 text-xs text-muted-foreground hover:underline"
          >
            <FileTextIcon className="size-6" />
            {photo.exists ? photo.fileName : `${photo.fileName} is missing from the folder`}
          </a>
        )}
        <Button
          size="icon"
          variant="outline"
          aria-label="Delete photo"
          className="absolute end-2 top-2 opacity-0 group-hover/photo:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
          onClick={() => remove.mutate({ id: photo.id })}
        >
          <Trash2Icon />
        </Button>
      </div>
      {receipt.photos.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {receipt.photos.map((each, index) => (
            <button
              key={each.id}
              type="button"
              aria-label={`Show ${each.fileName}`}
              onClick={() => setShown(index)}
              className={cn(
                "size-12 cursor-pointer overflow-hidden rounded-md border bg-muted/30",
                each === photo && "ring-2 ring-ring",
              )}
            >
              {isImage(each) ? (
                <img src={photoUrl(book, each.id)} alt="" className="size-full object-cover" />
              ) : (
                <FileTextIcon className="m-auto size-4 text-muted-foreground" />
              )}
            </button>
          ))}
        </div>
      )}
      <Zoom photo={zoomed} onClose={() => setZoomed(null)} />
    </section>
  );
}

/** A photo at full size, fitted to the window or at twice its size. */
function Zoom({ photo, onClose }: { photo: ReceiptPhoto | null; onClose: () => void }) {
  const { id: book } = useBook();
  const [scale, setScale] = useState<"fit" | "full">("fit");
  return (
    <Dialog open={photo !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="h-[90vh] max-w-5xl">
        <div className="flex items-center gap-2 border-b px-4 py-2 pe-12">
          <DialogTitle className="flex-1 truncate text-sm">{photo?.fileName}</DialogTitle>
          <Button variant="ghost" onClick={() => setScale(scale === "fit" ? "full" : "fit")}>
            {scale === "fit" ? <ZoomInIcon /> : <ZoomOutIcon />}
            {scale === "fit" ? "Zoom in" : "Fit"}
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          {photo !== null && (
            <img
              src={photoUrl(book, photo.id)}
              alt={photo.fileName}
              className={cn(
                "mx-auto",
                scale === "fit"
                  ? "max-h-[calc(90vh-3.5rem)] object-contain"
                  : "w-[200%] max-w-none",
              )}
            />
          )}
        </ScrollArea>
      </DialogPopup>
    </Dialog>
  );
}
