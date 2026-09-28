import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.NARRATION = "off";
process.env.FIREVERSE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fireverse-test-"));
