/** Brewery dungeon regions (percent of birrificio.jpg), aligned to oneshot fog boxes. */

export type DungeonRoomId =
  | "stairs"
  | "cellar"
  | "mosaic"
  | "well"
  | "lab"
  | "store";

export type Region = {
  id: DungeonRoomId;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export const DUNGEON_ROOMS: Record<DungeonRoomId, Region> = {
  stairs: { id: "stairs", label: "Stairs", left: 67.87, top: 0.32, width: 31.99, height: 42.34 },
  cellar: { id: "cellar", label: "Cellar", left: 2.49, top: 1.9, width: 65.1, height: 38.33 },
  mosaic: { id: "mosaic", label: "Mosaic", left: 11.36, top: 37.7, width: 85.46, height: 23.86 },
  well: { id: "well", label: "Well", left: 5.26, top: 60, width: 28.44, height: 19.32 },
  lab: { id: "lab", label: "Laboratory", left: 25.6, top: 60, width: 41.9, height: 35.1 },
  store: { id: "store", label: "Store", left: 67.5, top: 60, width: 27.3, height: 19.7 },
};

export function roomForNode(nodeId: string): DungeonRoomId | null {
  if (
    nodeId === "descend" ||
    nodeId.startsWith("glowkindle") ||
    nodeId.startsWith("hook_")
  ) {
    return nodeId === "descend" ? "stairs" : null;
  }
  if (
    nodeId.includes("corridor") ||
    nodeId.includes("hole") ||
    nodeId.includes("magma") ||
    nodeId === "fight_magma"
  ) {
    return "mosaic";
  }
  if (nodeId.includes("cellar") || nodeId === "fight_cellar_rats") return "cellar";
  if (nodeId.includes("well")) return "well";
  if (nodeId.includes("store")) return "store";
  if (
    nodeId.includes("lab") ||
    nodeId === "fight_spider" ||
    nodeId === "enter_lab" ||
    nodeId === "post_spider"
  ) {
    return "lab";
  }
  return null;
}

export function insideRegion(region: Region, x: number, y: number): boolean {
  return (
    x >= region.left &&
    x <= region.left + region.width &&
    y >= region.top &&
    y <= region.top + region.height
  );
}

/** CSS background-size / position so a room crop fills the element. */
export function cropStyle(region: Region): { size: string; position: string } {
  const sx = 10000 / region.width;
  const sy = 10000 / region.height;
  const px =
    region.width >= 99.9 ? 0 : (region.left / (100 - region.width)) * 100;
  const py =
    region.height >= 99.9 ? 0 : (region.top / (100 - region.height)) * 100;
  return {
    size: `${sx}% ${sy}%`,
    position: `${px}% ${py}%`,
  };
}
