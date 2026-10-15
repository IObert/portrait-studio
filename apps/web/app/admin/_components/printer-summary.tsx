import type { PrinterView } from "@/lib/admin/printer-status";

const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h ago` : new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium" });
};

type Tone = "ok" | "warn" | "off";

/**
 * Printing at a glance (SPEC §11.2): is printing on, is a print agent connected,
 * and is it driving a real printer or the simulator. One line, one tone.
 */
export function describePrinting(printingEnabled: boolean, p: PrinterView): { tone: Tone; text: string } {
  if (!printingEnabled) return { tone: "off", text: p.kind === "online" ? "Printing off (agent connected)" : "Printing off" };
  if (p.kind === "none") return { tone: "warn", text: "Printing on, no print agent connected yet" };
  if (p.kind === "offline") return { tone: "warn", text: `Print agent offline, last seen ${ago(p.lastSeen)}` };
  const target = p.mode === "simulate" ? "simulator, no printer" : `printer ${p.queue}`;
  const ok = p.status === "idle" || p.status === "printing";
  const status = p.status === "idle" ? "ready" : p.status.replaceAll("_", " ");
  return { tone: ok ? (p.mode === "simulate" ? "warn" : "ok") : "warn", text: `${status[0]!.toUpperCase()}${status.slice(1)}: ${target}${p.detail ? ` (${p.detail})` : ""}` };
}

const DOT: Record<Tone, string> = { ok: "bg-go", warn: "bg-pause", off: "bg-slate/40" };

export function PrinterSummary({ printingEnabled, printer }: { printingEnabled: boolean; printer: PrinterView }) {
  const { tone, text } = describePrinting(printingEnabled, printer);
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${tone === "off" ? "text-slate" : "text-ink"}`} data-testid="printer-summary">
      <PrinterIcon />
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden />
      {text}
    </span>
  );
}

function PrinterIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4 shrink-0 text-slate" aria-hidden>
      <path d="M6 7V3h8v4M6 14H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-2" />
      <path d="M6 11h8v6H6z" />
    </svg>
  );
}
