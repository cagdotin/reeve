import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@reeve/ui/components/button";

/** Copies text, and says so for a moment; `copied` is true while it does. */
export const useCopy = () => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };
  return { copied, copy };
};

export function CopyButton({ text, children }: { text: string; children: ReactNode }) {
  const { copied, copy } = useCopy();
  return (
    <Button variant="ghost" onClick={() => copy(text)}>
      {copied ? <CheckIcon data-icon="inline-start" /> : <CopyIcon data-icon="inline-start" />}
      {copied ? "Copied" : children}
    </Button>
  );
}
