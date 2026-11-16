// Verbatim from PROMPTS.md §A1 and §A2.

// PROMPTS.md §A1, changed in D-56: a pet's face counts too (it used to ask for "a person's face", so a photo of a pet alone was refused).
export const FACE_DETECTION =
  "Does this image clearly show a face: of a person, or of a pet or other real animal that is a main subject of the photo? A face must be visible -- photos of only hands, feet, backs, or other body parts without a face do NOT count. Reply with only YES or NO.";

// PROMPTS.md §A2, changed in D-56: animals are counted as subjects of their own. The pet line used to be "only if the pet
// belongs to the subject(s)", which dropped a pet standing next to the person, and it named one animal type, so two pets became one.
export const SCENE_ANALYSIS = `Analyze this photo. Count ONLY the main subject(s) who are clearly posing or the focus of the photo. IGNORE background bystanders, passersby, people partially visible at frame edges, people on screens/posters, or anyone who is not a primary subject. Reply in EXACTLY this format:
Subjects: [number of PRIMARY PEOPLE only; 0 if the photo has no person]
Pets: [none OR every real pet or animal in the photo as "<count> <kind>", separated by commas, for example "1 dog" or "2 dogs, 1 cat"]
Positions: [centered, left-right pair, or group]
For Pets, list every real animal that is with the people or is the focus of the photo, wherever it is in the frame (in someone's arms, on a lap, on the floor, at the edge). Do NOT list toys, statues, drawings, animals on screens, posters or clothing, or wild animals far in the background.`;
