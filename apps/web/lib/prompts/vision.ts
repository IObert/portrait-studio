// Verbatim from PROMPTS.md §A1 and §A2.

export const FACE_DETECTION =
  "Does this image clearly show a person's face? A face must be visible -- photos of only hands, feet, backs, or other body parts without a face do NOT count. Reply with only YES or NO.";

export const SCENE_ANALYSIS = `Analyze this photo. Count ONLY the main subject(s) who are clearly posing or the focus of the photo. IGNORE background bystanders, passersby, people partially visible at frame edges, people on screens/posters, or anyone who is not a primary subject. Reply in EXACTLY this format:
Subjects: [number of PRIMARY subjects only]
Pets: [none OR animal type, only if the pet belongs to the subject(s)]
Positions: [centered, left-right pair, or group]`;
