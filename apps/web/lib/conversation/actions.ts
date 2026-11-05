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

/**
 * Style / background menu ids. They name the photo (job) the menu was sent for, so a menu from
 * earlier in the chat still works after newer messages (D-48). Menus sent before this carried only
 * `opt:<id>`; those are still read, for the photo currently waiting for an answer.
 */
export const ACTION_OPTION = {
  style: (optionId: string, jobId: string) => `ps:opt:style:${jobId}:${optionId}`,
  background: (optionId: string, jobId: string) => `ps:opt:background:${jobId}:${optionId}`,
  parse(payload: string | undefined): { kind: "style" | "background"; jobId: string; optionId: string } | null {
    const m = /^ps:opt:(style|background):([A-Za-z0-9_-]{8,64}):([a-z0-9-]+)$/.exec(payload ?? "");
    return m ? { kind: m[1] as "style" | "background", jobId: m[2]!, optionId: m[3]! } : null;
  },
} as const;
