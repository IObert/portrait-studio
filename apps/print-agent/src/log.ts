/** Human-readable console lines (§11.2). Never print the token. */
export function log(level: "info" | "warn" | "error", message: string): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (level === "info") console.log(line);
  else console.error(line);
}
