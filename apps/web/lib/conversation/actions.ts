/** Button / list payload ids (never shown to attendees). */
export const ACTION_SLIDESHOW = {
  yes: (jobId: string) => `ps:slide:yes:${jobId}`,
  no: (jobId: string) => `ps:slide:no:${jobId}`,
  parse(payload: string | undefined): { answer: "yes" | "no"; jobId: string } | null {
    const m = /^ps:slide:(yes|no):([A-Za-z0-9_-]{8,64})$/.exec(payload ?? "");
    return m ? { answer: m[1] as "yes" | "no", jobId: m[2]! } : null;
  },
} as const;
