/** Case- and accent-insensitive comparison for menu answers and keywords (SPEC §5.5). */
export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();
}

export function matchesKeyword(text: string, keywords: readonly string[]): boolean {
  const t = normalize(text);
  return t !== "" && keywords.some((k) => normalize(k) === t);
}
