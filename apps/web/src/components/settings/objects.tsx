import type { ReactNode } from "react";

/** Peeks in from the page's right edge, cut off by it, as an object resting on the section's rule. */
function Peek({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={`absolute top-5 right-0 bottom-0 left-4 overflow-hidden rounded-tl-lg border-t border-l border-foreground/10 ${className}`}
    >
      {children}
    </span>
  );
}

const SURFACE = "bg-[linear-gradient(160deg,var(--card),var(--secondary))]";

export function BankCardObject() {
  return (
    <Peek
      className={`${SURFACE} dark:bg-[linear-gradient(135deg,#2b2c33,#0d0d11_70%)] dark:shadow-[0_8px_24px_rgb(0_0_0/30%)]`}
    >
      <span className="absolute top-3 left-3 h-3.5 w-5 rounded-[3px] bg-[linear-gradient(135deg,#d8c79a,#8f7f55)]" />
      <span className="absolute bottom-2 left-3 text-[10px] tracking-[0.2em] text-foreground/50">
        •••• 0051
      </span>
    </Peek>
  );
}

export function BookObject() {
  return (
    <Peek className={`${SURFACE} dark:bg-[linear-gradient(160deg,#39302a,#1a1512)]`}>
      <span className="absolute inset-y-0 left-3 w-px bg-foreground/10" />
      <span className="absolute top-3 left-6 h-1 w-14 rounded-full bg-foreground/25 dark:bg-[#c9a877]/60" />
      <span className="absolute top-6 left-6 h-1 w-9 rounded-full bg-foreground/12 dark:bg-[#c9a877]/30" />
    </Peek>
  );
}

export function SlidersObject() {
  return (
    <Peek className={SURFACE}>
      {[0, 1, 2].map((row) => (
        <span
          key={row}
          className="absolute right-0 left-3 h-px bg-foreground/14"
          style={{ top: 14 + row * 15 }}
        >
          <span
            className="absolute -top-[3px] size-[7px] rounded-full bg-foreground/70"
            style={{ left: 18 + ((row * 47) % 70) }}
          />
        </span>
      ))}
    </Peek>
  );
}

export function PaletteObject() {
  return (
    <Peek className="grid grid-cols-2 bg-transparent">
      <span className="bg-[#0b0b0f]" />
      <span className="bg-white" />
    </Peek>
  );
}

export function ServerObject() {
  return (
    <Peek className={SURFACE}>
      {[0, 1].map((row) => (
        <span
          key={row}
          className="absolute right-0 left-3 flex h-5 items-center gap-1 rounded-l-sm bg-foreground/6 ps-2"
          style={{ top: 10 + row * 25 }}
        >
          <span className="size-1 rounded-full bg-[#6dbc98]" />
          <span className="size-1 rounded-full bg-foreground/20" />
        </span>
      ))}
    </Peek>
  );
}
