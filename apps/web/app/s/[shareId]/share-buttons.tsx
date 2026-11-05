"use client";

import { useState, useSyncExternalStore } from "react";
import { trackShareAction } from "@/lib/share/track-action";
import type { ShareEventKind } from "@/lib/share/track";

interface Props {
  shareId: string;
  imageUrl: string;
  shareText: string;
  labels: { share: string; copyText: string; copied: string; download: string };
}

/**
 * Share sheet with the image file (SPEC §6.2). Falls back to download where
 * `navigator.canShare({ files })` is unsupported (e.g. desktop). Each use is counted, without any personal data (D-50).
 */
export function ShareButtons({ shareId, imageUrl, shareText, labels }: Props) {
  const [copied, setCopied] = useState(false);
  const track = (kind: ShareEventKind) => void trackShareAction(shareId, kind).catch(() => {});
  // Browser capability: false on the server and during hydration, so the markup matches; the real value follows.
  const canShareFiles = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.canShare === "function",
    () => false,
  );

  async function share() {
    const res = await fetch(imageUrl);
    const file = new File([await res.blob()], "image.jpg", { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      // Counted when the share sheet completes, not when it is dismissed.
      if (await navigator.share({ files: [file], text: shareText }).then(() => true, () => false)) track("share");
    } else {
      download(file);
    }
  }

  function download(file?: File) {
    const a = document.createElement("a");
    a.href = file ? URL.createObjectURL(file) : imageUrl;
    a.download = "image.jpg";
    a.click();
    track("download");
  }

  async function copy() {
    await navigator.clipboard.writeText(shareText);
    track("copy");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const btn = "w-full rounded-full px-6 py-3.5 text-base font-semibold transition-colors focus-visible:outline-white";
  return (
    <div className="flex w-full flex-col gap-3">
      {canShareFiles && (
        <button type="button" onClick={share} className={`${btn} bg-white text-ink hover:bg-white/90`}>
          {labels.share}
        </button>
      )}
      {shareText && (
        <button type="button" onClick={copy} className={`${btn} border border-white/30 text-white hover:bg-white/10`}>
          {copied ? labels.copied : labels.copyText}
        </button>
      )}
      <a href={imageUrl} download="image.jpg" onClick={() => track("download")} className={`${btn} border border-white/30 text-center text-white hover:bg-white/10`}>
        {labels.download}
      </a>
    </div>
  );
}
