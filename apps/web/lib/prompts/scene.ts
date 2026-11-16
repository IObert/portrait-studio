// Verbatim from PROMPTS.md §E3 (scene line) and §E11 (final reminder).

const MULTI_IDENTITY =
  " Each person has DISTINCT facial features, hair, and build — do NOT merge, swap, or blend their features. Each person must remain visually distinct from the others and recognizable as themselves.";

export interface Scene {
  /** Primary human subjects, 1 up to MAX_SUBJECTS (SPEC §9.2). */
  subjects: number;
  /** Pet type from scene analysis, or null for none. */
  pet: string | null;
}

/** `pet` is the vision model's list of the animals, e.g. "1 dog" or "2 dogs, 1 cat" (D-56), so it is written as a list and never as "a ${pet}". */
export function sceneLine({ subjects: n, pet }: Scene): string {
  if (n === 0 && pet)
    return `This photo has no people, only these animals: ${pet}. The animals are the subjects of the portrait. The output must contain exactly those animals and no people at all — do not add, invent, or hallucinate any person, hand, or human figure.`;
  if (n > 1 && pet)
    return `This photo has exactly ${n} HUMAN subjects and these animals: ${pet}. Include ALL of them positioned as shown. The output must contain exactly ${n} people and exactly those animals — no more, no fewer. The animals are animals, NOT people: do not turn any of them into a human.${MULTI_IDENTITY}`;
  if (n > 1)
    return `This photo has exactly ${n} HUMAN subjects. Include ALL of them positioned as shown. The output must contain exactly ${n} people — no more, no fewer.${MULTI_IDENTITY}`;
  if (pet)
    return `This photo has exactly 1 person and these animals: ${pet}. The animals are animals, NOT people — do not turn any of them into a human. The output must contain exactly 1 person and exactly those animals — no other people.`;
  return "This photo has exactly 1 person. The output must contain exactly 1 human figure — do not add, invent, or hallucinate any additional people. Anything else in the photo (objects, posters, screens, reflections) is NOT a person.";
}

export function finalReminder({ subjects: n, pet }: Scene): string {
  if (n === 0 && pet) return `\n\nFINAL REMINDER: Only these animals in the output: ${pet}. No people at all. Every animal stays a whole animal, fully in the picture.`;
  if (n > 1)
    return `\n\nFINAL REMINDER: Exactly ${n} humans in the output — no more, no fewer.${pet ? ` The animals (${pet}) stay animals, fully in the picture: do NOT turn any of them into a person, and do not drop any of them.` : ""}`;
  if (pet)
    return `\n\nFINAL REMINDER: Exactly 1 human and these animals in the output: ${pet}. The animals stay animals, fully in the picture — do NOT turn any of them into a person, and do not drop any of them. No other people.`;
  return "\n\nFINAL REMINDER: Exactly 1 human in the output. No other people. Anything else visible (objects, posters, screens, reflections, background figures) must NOT become a person.";
}

/**
 * What a photo with animals needs on top of the people (D-56). The style, background and composition lines are written
 * about people, so alone they let an animal be cut out ("render only the subject"), redrawn as scenery ("recreate the
 * background"), cropped (chest-up framing) or drawn without its own coloring. Null when there are no animals.
 */
export function animalLine({ pet }: Scene): string | null {
  if (!pet) return null;
  return `Animals: Every animal in the photo (${pet}) is a main subject of the portrait, as important as the people, whatever the background instruction says: never part of the background, never removed, never cut out. Keep each one clearly recognizable: the same kind of animal, with its own fur or coat color, markings, ear shape, eye color, and any collar or harness. Keep every animal inside the picture with its head and body not cut off by an edge, even if that means showing more than the chest-up framing used for people; no head or face may be cut off by an edge.`;
}
