import { loadCampaign } from "../src/local/campaign.js";
import { loadChargen } from "../src/local/chargen.js";
import { ensureDataDir } from "../src/local/paths.js";

let booted = false;

export function boot(): void {
  if (booted) return;
  ensureDataDir();
  loadCampaign();
  loadChargen();
  booted = true;
}

/** Replace Math.random with a script of d-faces for the next rolls: face(20, 1) → a natural 1 on a d20. */
export function scriptDice(faces: Array<[sides: number, face: number]>): () => void {
  const original = Math.random;
  const queue = [...faces];
  Math.random = () => {
    const next = queue.shift();
    if (!next) return original();
    const [sides, face] = next;
    return (face - 1 + 0.5) / sides;
  };
  return () => {
    Math.random = original;
  };
}
