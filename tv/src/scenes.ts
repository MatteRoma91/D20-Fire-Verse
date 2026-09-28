/** Campaign phase art + titles — full Luppolandia oneshot (v9 path). */

export type SceneArt = {
  id: string;
  title: string;
  chapter: string;
  art: string;
  tone: "warm" | "cool" | "ember" | "victory";
};

const ART = {
  home: "/art/home.png",
  tavern: "/art/tavern.png",
  glowkindle: "/art/glowkindle.png",
  cellar: "/art/cellar.png",
  cellarRoom: "/art/cellar-room.png",
  well: "/art/well-room.png",
  store: "/art/store-room.png",
  combatRats: "/art/combat-rats.png",
  seal: "/art/iron-seal.png",
  lab: "/art/lab-spider.png",
  magma: "/art/magma.png",
  epilogue: "/art/epilogue.png",
  chargen: "/art/chargen.png",
  lobby: "/art/oneshot-brewery.jpg",
};

const BY_NODE: Record<string, SceneArt> = {
  hook_notice: {
    id: "hook_notice",
    title: "The Notice",
    chapter: "Act I · Luppolandia",
    art: ART.tavern,
    tone: "warm",
  },
  hook_rumor: {
    id: "hook_rumor",
    title: "Rumors at the Door",
    chapter: "Act I · Luppolandia",
    art: ART.tavern,
    tone: "warm",
  },
  glowkindle: {
    id: "glowkindle",
    title: "The Wizard's Tower Brewing Co.",
    chapter: "Act I · The Job",
    art: ART.glowkindle,
    tone: "warm",
  },
  glowkindle_ask: {
    id: "glowkindle_ask",
    title: "What Lies Beneath",
    chapter: "Act I · The Job",
    art: ART.glowkindle,
    tone: "warm",
  },
  descend: {
    id: "descend",
    title: "The Trapdoor",
    chapter: "Act II · Descent",
    art: ART.cellar,
    tone: "cool",
  },
  corridor_arrive: {
    id: "corridor_arrive",
    title: "Mosaic Corridor",
    chapter: "Act II · The Hub",
    art: ART.cellar,
    tone: "cool",
  },
  corridor_hub: {
    id: "corridor_hub",
    title: "Corridor Hub",
    chapter: "Act II · Free Exploration",
    art: ART.cellar,
    tone: "cool",
  },
  corridor_tiles: {
    id: "corridor_tiles",
    title: "The Colored Tiles",
    chapter: "Puzzle · Mosaic",
    art: ART.cellar,
    tone: "cool",
  },
  corridor_tiles_force: {
    id: "corridor_tiles_force",
    title: "Blades & Passage",
    chapter: "Puzzle · Mosaic",
    art: ART.cellar,
    tone: "ember",
  },
  lab_locked_peek: {
    id: "lab_locked_peek",
    title: "Door of Three Seals",
    chapter: "Act II · Locked",
    art: ART.seal,
    tone: "cool",
  },
  cellar_enter: {
    id: "cellar_enter",
    title: "The Cellar",
    chapter: "Seal 1 · Cellar",
    art: ART.cellarRoom,
    tone: "cool",
  },
  fight_cellar_rats: {
    id: "fight_cellar_rats",
    title: "Pack Behind the Barrels",
    chapter: "Combat · Cellar",
    art: ART.combatRats,
    tone: "ember",
  },
  cellar_vessels: {
    id: "cellar_vessels",
    title: "Order of the Vessels",
    chapter: "Puzzle · Cellar Seal",
    art: ART.cellarRoom,
    tone: "cool",
  },
  well_enter: {
    id: "well_enter",
    title: "The Well",
    chapter: "Seal 2 · Well",
    art: ART.well,
    tone: "cool",
  },
  well_lock: {
    id: "well_lock",
    title: "Pulley Lock",
    chapter: "Puzzle · Well",
    art: ART.well,
    tone: "cool",
  },
  fight_well_centipedes: {
    id: "fight_well_centipedes",
    title: "Noise from the Deep",
    chapter: "Combat · Well",
    art: ART.well,
    tone: "ember",
  },
  well_bucket: {
    id: "well_bucket",
    title: "Seal of the Well",
    chapter: "Seal 2 · Claimed",
    art: ART.well,
    tone: "cool",
  },
  store_enter: {
    id: "store_enter",
    title: "Alchemical Store",
    chapter: "Seal 3 · Residue",
    art: ART.store,
    tone: "cool",
  },
  store_vials: {
    id: "store_vials",
    title: "Four Vials",
    chapter: "Puzzle · Phase A",
    art: ART.store,
    tone: "cool",
  },
  store_mixture: {
    id: "store_mixture",
    title: "Residue Mixture",
    chapter: "Puzzle · Phase B",
    art: ART.store,
    tone: "cool",
  },
  hole_rats: {
    id: "hole_rats",
    title: "From the Threshold Hole",
    chapter: "Combat · Ambush",
    art: ART.combatRats,
    tone: "ember",
  },
  hole_after_rats: {
    id: "hole_after_rats",
    title: "Omen of the Hole",
    chapter: "Act II · Warning",
    art: ART.cellar,
    tone: "cool",
  },
  hole_centipedes: {
    id: "hole_centipedes",
    title: "Centipedes from Below",
    chapter: "Combat · Ambush",
    art: ART.cellar,
    tone: "ember",
  },
  hole_after_centipedes: {
    id: "hole_after_centipedes",
    title: "Burnt Hair on the Rim",
    chapter: "Act II · Warning",
    art: ART.cellar,
    tone: "cool",
  },
  short_rest_mid: {
    id: "short_rest_mid",
    title: "Short Rest",
    chapter: "Recovery",
    art: ART.seal,
    tone: "cool",
  },
  lab_vault: {
    id: "lab_vault",
    title: "Three Seals Aligned",
    chapter: "Act III · Vault",
    art: ART.seal,
    tone: "ember",
  },
  enter_lab: {
    id: "enter_lab",
    title: "Ember Silk",
    chapter: "Act III · Laboratory",
    art: ART.lab,
    tone: "ember",
  },
  lab_rest: {
    id: "lab_rest",
    title: "Breath Before the Boss",
    chapter: "Act III · Threshold",
    art: ART.lab,
    tone: "ember",
  },
  fight_spider: {
    id: "fight_spider",
    title: "Infernal Spider",
    chapter: "Combat · Boss",
    art: ART.lab,
    tone: "ember",
  },
  post_spider: {
    id: "post_spider",
    title: "The Source Falls Silent",
    chapter: "Act III · Aftermath",
    art: ART.lab,
    tone: "cool",
  },
  cliffhanger_magma: {
    id: "cliffhanger_magma",
    title: "Orange in the Corridor",
    chapter: "Finale · Ambush",
    art: ART.magma,
    tone: "ember",
  },
  fight_magma: {
    id: "fight_magma",
    title: "Magma Rat",
    chapter: "Combat · Exit Tax",
    art: ART.magma,
    tone: "ember",
  },
  epilogue: {
    id: "epilogue",
    title: "Pale Ale & Victory",
    chapter: "Epilogue",
    art: ART.epilogue,
    tone: "victory",
  },
  END_SAVE: {
    id: "END_SAVE",
    title: "Saved at the Cliff",
    chapter: "Session Break",
    art: ART.magma,
    tone: "ember",
  },
  END_WIN: {
    id: "END_WIN",
    title: "Adventure Complete",
    chapter: "The Table is the TV",
    art: ART.epilogue,
    tone: "victory",
  },
};

export function sceneForNode(nodeId: string | undefined | null): SceneArt {
  if (!nodeId) {
    return {
      id: "unknown",
      title: "Luppolandia Brew",
      chapter: "Campaign",
      art: ART.home,
      tone: "warm",
    };
  }
  return (
    BY_NODE[nodeId] ?? {
      id: nodeId,
      title: nodeId.replace(/_/g, " "),
      chapter: "Campaign",
      art: ART.cellar,
      tone: "cool",
    }
  );
}

export { ART };
