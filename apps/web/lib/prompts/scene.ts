// Verbatim from PROMPTS.md §E3 (scene line) and §E11 (final reminder).

const MULTI_IDENTITY =
  " Each person has DISTINCT facial features, hair, and build — do NOT merge, swap, or blend their features. Each person must remain visually distinct from the others and recognizable as themselves.";

export interface Scene {
  /** Primary human subjects, 1–4 (SPEC §9.2). */
  subjects: number;
  /** Pet type from scene analysis, or null for none. */
  pet: string | null;
}

export function sceneLine({ subjects: n, pet }: Scene): string {
  if (n > 1 && pet)
    return `This photo has exactly ${n} HUMAN subjects and a ${pet}. Include ALL of them positioned as shown. The output must contain exactly ${n} people and the ${pet} — no more, no fewer.${MULTI_IDENTITY}`;
  if (n > 1)
    return `This photo has exactly ${n} HUMAN subjects. Include ALL of them positioned as shown. The output must contain exactly ${n} people — no more, no fewer.${MULTI_IDENTITY}`;
  if (pet)
    return `This photo has exactly 1 person and a ${pet}. The ${pet} is an animal, NOT a person — do not turn the ${pet} into a human. The output must contain exactly 1 person and the ${pet} — no other people.`;
  return "This photo has exactly 1 person. The output must contain exactly 1 human figure — do not add, invent, or hallucinate any additional people. Anything else in the photo (objects, posters, screens, reflections) is NOT a person.";
}

export function finalReminder({ subjects: n, pet }: Scene): string {
  if (n > 1) return `\n\nFINAL REMINDER: Exactly ${n} humans in the output — no more, no fewer.`;
  if (pet)
    return `\n\nFINAL REMINDER: Exactly 1 human and 1 ${pet} in the output. The ${pet} is an animal — do NOT turn it into a person. No other people.`;
  return "\n\nFINAL REMINDER: Exactly 1 human in the output. No other people. Anything else visible (objects, posters, screens, reflections, background figures) must NOT become a person.";
}
