import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, "../../..");
export const CONTENT_ROOT = path.join(REPO_ROOT, "content");
export const CAMPAIGN_DIR = path.join(
  CONTENT_ROOT,
  "campaigns",
  "luppolandia-brew",
);
export const DATA_DIR = process.env.FIREVERSE_DATA_DIR
  ? path.resolve(process.env.FIREVERSE_DATA_DIR)
  : path.join(REPO_ROOT, "backend", "data");

export function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function ensureDataDir(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
