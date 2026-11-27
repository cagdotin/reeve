import { DownloadIcon } from "lucide-react";
import { assetUrl, FOREST, KIT_FILES, KIT_ZIP, PARCHMENT, SAGE } from "@/components/brand/assets";
import { Button } from "@reeve/ui/components/button";

const GROUPS: ReadonlyArray<{ label: string; matches: (name: string) => boolean }> = [
  { label: "Full logo", matches: (name) => name.startsWith("logo") },
  { label: "Mark", matches: (name) => name.startsWith("mark") },
  { label: "Wordmark", matches: (name) => name.startsWith("wordmark") },
  { label: "App icons", matches: (name) => name.startsWith("icon") },
  { label: "Link preview", matches: (name) => name.startsWith("social") },
  { label: "Color tokens", matches: (name) => name.startsWith("colors") },
];

const nameOf = (path: string) => path.split("/").at(-1) ?? path;
const isImage = (path: string) => /\.(svg|png)$/.test(path);
/** The tile each file shows on: light artwork would disappear on a light one. */
const tileColor = (path: string) => {
  if (/(parchment|logo-dark|social-card)/.test(path)) return FOREST;
  return /icon-/.test(path) ? "#E0DECF" : PARCHMENT;
};

/**
 * On a Retina screen a small PNG is stretched to twice its pixels and blurs, so its preview takes the
 * next size up there, as a browser tab does. The download is still the file named.
 */
const sharperPreview = (path: string) => {
  const small = /^(.*-)(16|32|64)\.png$/.exec(path);
  if (!small) return undefined;
  return `${assetUrl(path)} 1x, ${assetUrl(`${small[1]}${Number(small[2]) * 2}.png`)} 2x`;
};

function KitFile({ path }: { path: string }) {
  const name = nameOf(path);
  return (
    <li>
      <a
        href={assetUrl(path)}
        download={name}
        aria-label={`Download ${name}`}
        className="group block rounded-lg border bg-card outline-hidden hover:border-(--ink)/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className="flex h-24 items-center justify-center rounded-t-lg p-3"
          style={{ backgroundColor: tileColor(path) }}
        >
          {isImage(path) ? (
            <img
              src={assetUrl(path)}
              alt=""
              loading="lazy"
              srcSet={sharperPreview(path)}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="font-mono text-xs" style={{ color: FOREST }}>
              {name.split(".").at(-1)}
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5 border-t px-2.5 py-1.5 text-[11px]">
          <span className="min-w-0 flex-1 truncate" title={name}>
            {name}
          </span>
          <DownloadIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </span>
      </a>
    </li>
  );
}

export function BrandKit() {
  return (
    <>
      <div
        className="my-6 flex items-center justify-between border gap-6 rounded-2xl p-10 max-md:flex-col max-md:items-start max-md:p-7"
        style={{ backgroundColor: FOREST, color: PARCHMENT }}
      >
        <div>
          <div className="text-2xl font-semibold tracking-tight">
            Download the <span style={{ color: SAGE }}>brand kit</span>
          </div>
          <p className="mt-1 text-sm opacity-80">
            {KIT_FILES.length} files: logos, marks, app icons, a link preview and color tokens.
          </p>
        </div>
        <Button
          variant="outline"
          className="shrink-0"
          render={<a href={KIT_ZIP} download="reeve-brand-kit.zip" aria-label="Download kit" />}
        >
          <DownloadIcon data-icon="inline-start" />
          Download kit
        </Button>
      </div>
      {GROUPS.map((group) => {
        const files = KIT_FILES.filter((path) => group.matches(nameOf(path)));
        return (
          <section key={group.label} className="mt-6">
            <h3 className="mb-2 text-[15px] font-semibold">{group.label}</h3>
            <ul className="grid grid-cols-5 gap-2.5 max-lg:grid-cols-3 max-md:grid-cols-2">
              {files.map((path) => (
                <KitFile key={path} path={path} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
