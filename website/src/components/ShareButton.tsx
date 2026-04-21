"use client";

import { useState } from "react";

interface ShareButtonProps {
  url: string;
  title: string;
}

export default function ShareButton({ url, title }: ShareButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  const handleClick = async () => {
    // Prefer the Web Share API when available (mobile mostly)
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user cancelled or share failed — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      setTimeout(() => setState("idle"), 2200);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 2200);
    }
  };

  const label =
    state === "copied" ? "Link copied" : state === "error" ? "Copy failed" : "Share this essay";

  return (
    <button
      type="button"
      onClick={handleClick}
      className="share-btn"
      aria-live="polite"
    >
      <svg
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>
      {label}
    </button>
  );
}
