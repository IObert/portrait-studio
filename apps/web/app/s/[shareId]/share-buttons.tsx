"use client";

import { useState } from "react";

interface Props {
  imageUrl: string;
  shareText: string;
  labels: { share: string; copyText: string; copied: string; download: string };
}

/**
 * Share sheet with the image file (SPEC §6.2). Falls back to download where
 * `navigator.canShare({ files })` is unsupported (e.g. desktop). No tracking.
 */
export function ShareButtons({ imageUrl, shareText, labels }: Props) {
  const [copied, setCopied] = useState(false);
  const [canShareFiles] = useState(() => typeof navigator !== "undefined" && typeof navigator.canShare === "function");

  async function share() {
    const res = await fetch(imageUrl);
    const file = new File([await res.blob()], "image.jpg", { type: "image/jpeg" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: shareText }).catch(() => {});
    } else {
      download(file);
    }
  }

  function download(file?: File) {
    const a = document.createElement("a");
    a.href = file ? URL.createObjectURL(file) : imageUrl;
    a.download = "image.jpg";
    a.click();
  }

  async function copy() {
    await navigator.clipboard.writeText(shareText);
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
      <a href={imageUrl} download="image.jpg" className={`${btn} border border-white/30 text-center text-white hover:bg-white/10`}>
        {labels.download}
      </a>
    </div>
  );
}
