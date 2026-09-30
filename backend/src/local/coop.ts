/** Shared table co-op: story votes, skill volunteers, puzzle claim + soft hints. */

import { abilityMod, getPregen, type StoryNode } from "./campaign.js";
import { rollD20, type DiceRoll } from "./dice.js";
import type { Player } from "./types.js";

export const VOTE_MS = 20_000;
export const CHECK_MS = 25_000;
export const PUZZLE_IDLE_MS = 45_000;

export type VoteState = {
  nodeId: string;
  votes: Record<string, string>;
  openedAt: number;
  closesAt: number;
};

export type CheckOffer = {
  nodeId: string;
  volunteers: string[];
  helpers: string[];
  openedAt: number;
  closesAt: number;
};

export type PuzzleHint = {
  playerId: string;
  name: string;
  slot: number;
  optionId: string;
};

export type PuzzleCoop = {
  holderId?: string;
  holderName?: string;
  claimedAt?: number;
  draft: string[];
  hints: PuzzleHint[];
  history: Array<{ guess: string[]; black: number; white: number }>;
  lastScore?: { black: number; white: number };
};

export function playerCheckBonus(
  player: Player,
  ability: string,
  skill?: string,
): number {
  const pregen = getPregen(player.characterId);
  if (!pregen) return 0;
  const skilled = skill
    ? ((pregen as { skills?: string[] }).skills ?? []).includes(skill)
    : false;
  return abilityMod(pregen.abilities[ability] ?? 10) + (skilled ? (pregen.proficiencyBonus ?? 2) : 0);
}

export function scoreMastermind(guess: string[], code: string[]): { black: number; white: number } {
  let black = 0;
  const codeLeft: string[] = [];
  const guessLeft: string[] = [];
  for (let i = 0; i < code.length; i += 1) {
    if (guess[i] === code[i]) black += 1;
    else {
      codeLeft.push(code[i]!);
      guessLeft.push(guess[i]!);
    }
  }
  let white = 0;
  for (const g of guessLeft) {
    const idx = codeLeft.indexOf(g);
    if (idx >= 0) {
      white += 1;
      codeLeft.splice(idx, 1);
    }
  }
  return { black, white };
}

/** How many vessel constraints hold for a full guess (Eye→X→Wave→Spiral solution). */
export function vesselConstraintsMet(guess: string[]): number {
  if (guess.length !== 4) return 0;
  let n = 0;
  const [a, b, c, d] = guess;
  if (b === "x" || c === "x") n += 1; // X neither first nor last
  if (
    guess.findIndex((x) => x === "spiral") === guess.findIndex((x) => x === "wave") + 1
  ) {
    n += 1;
  }
  if (guess.indexOf("eye") >= 0 && guess.indexOf("x") >= 0 && guess.indexOf("eye") < guess.indexOf("x")) {
    n += 1;
  }
  if (a !== "wave") n += 1;
  void d;
  return n;
}

/** Which mixture basin (0–2) first disagrees with the solution. */
export function mixtureFirstMiss(guess: string[], solution: string[]): number {
  for (let i = 0; i < solution.length; i += 1) {
    if (guess[i] !== solution[i]) return i;
  }
  return -1;
}

export function tallyVotes(
  votes: Record<string, string>,
  eligible: string[],
): { winner: string | null; tied: string[]; counts: Record<string, number> } {
  const counts: Record<string, number> = {};
  for (const pid of eligible) {
    const v = votes[pid];
    if (!v) continue;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  let best = 0;
  for (const n of Object.values(counts)) if (n > best) best = n;
  if (best === 0) return { winner: null, tied: [], counts };
  const tied = Object.keys(counts).filter((id) => counts[id] === best);
  if (tied.length === 1) return { winner: tied[0]!, tied, counts };
  return { winner: null, tied, counts };
}

export function breakTie(tied: string[]): { choiceId: string; roll: DiceRoll } {
  const face = rollD20();
  const idx = (face - 1) % tied.length;
  const choiceId = tied[idx]!;
  return {
    choiceId,
    roll: {
      id: `tie-${Date.now()}`,
      roller: "The table",
      notation: "1d20",
      values: [face],
      sides: [20],
      modifier: 0,
      total: face,
      purpose: "other",
      label: `Tie break · ${tied.join(" vs ")}`,
      at: new Date().toISOString(),
    },
  };
}

export function emptyPuzzleCoop(): PuzzleCoop {
  return { draft: [], hints: [], history: [] };
}

export function checkRoster(
  players: Player[],
  node: StoryNode,
): Array<{ playerId: string; name: string; bonus: number }> {
  if (!node.check) return [];
  return players.map((p) => ({
    playerId: p.playerId,
    name: p.characterName,
    bonus: playerCheckBonus(p, node.check!.ability, node.check!.skill),
  }));
}
