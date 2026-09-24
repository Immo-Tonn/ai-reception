/** "You" (the demo owner's own name) is UI chrome, not a person's name —
 * every other staff name (Elena, Marco, Sven, …) is a real demo person
 * and must never be translated. `youLabel` comes from
 * `Messages["common"].you`. */
export function getStaffLabel(name: string, youLabel: string): string {
  return name === "You" ? youLabel : name;
}
