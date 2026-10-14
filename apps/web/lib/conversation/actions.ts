/** Button / list payload ids (never shown to attendees). */
export const ACTION_SLIDESHOW = {
  yes: (jobId: string) => `ps:slide:yes:${jobId}`,
  no: (jobId: string) => `ps:slide:no:${jobId}`,
  /** Print and show on the booth screen (D-24). */
  print: (jobId: string) => `ps:slide:print:${jobId}`,
  /** Print only, from the print menu (D-28): the screen choice stays as it was. */
  printOnly: (jobId: string) => `ps:slide:printonly:${jobId}`,
  parse(payload: string | undefined): { answer: "print" | "printonly" | "yes" | "no"; jobId: string } | null {
    const m = /^ps:slide:(print|printonly|yes|no):([A-Za-z0-9_-]{8,64})$/.exec(payload ?? "");
    return m ? { answer: m[1] as "print" | "printonly" | "yes" | "no", jobId: m[2]! } : null;
  },
} as const;
