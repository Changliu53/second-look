"use client";

import { useState } from "react";
import { BUTTON } from "@/components/ui";

/** Copies text to the clipboard and says so for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" className={BUTTON} onClick={copy}>
      {copied ? "Copied" : label}
    </button>
  );
}
