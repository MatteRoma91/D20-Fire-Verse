/** Painted portraits shipped in tv/public/art/portraits. */

export const PORTRAITS = [
  "brenna_ironveal",
  "quill_ashmere",
  "mira_softstep",
  "torin_emberhand",
  "cg_dragonborn",
  "cg_tiefling",
  "cg_halforc",
  "cg_woodelf",
  "cg_bard",
  "cg_gnome",
  "glowkindle",
  "messenger",
] as const;

export type PortraitId = (typeof PORTRAITS)[number];

export function portraitUrl(id: string): string {
  return `/art/portraits/${id}.webp`;
}

export function isPortraitId(id: unknown): id is PortraitId {
  return typeof id === "string" && (PORTRAITS as readonly string[]).includes(id);
}

/** A sensible face for a forged hero who didn't pick one. */
export function defaultPortrait(raceId: string, classId: string): PortraitId {
  if (raceId === "dragonborn") return "cg_dragonborn";
  if (raceId === "tiefling") return "cg_tiefling";
  if (raceId === "half_orc") return "cg_halforc";
  if (raceId === "wood_elf") return "cg_woodelf";
  if (raceId === "rock_gnome") return "cg_gnome";
  if (raceId === "hill_dwarf" || raceId === "mountain_dwarf") return "torin_emberhand";
  if (raceId.endsWith("halfling")) return "mira_softstep";
  if (raceId === "high_elf" || raceId === "half_elf") return "quill_ashmere";
  if (classId === "bard" || classId === "warlock" || classId === "sorcerer") return "cg_bard";
  return "brenna_ironveal";
}
