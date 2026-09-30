import os from "node:os";
import { Bonjour } from "bonjour-service";

/**
 * Let the Fire TV app find this table on the home network without typing an address:
 * the server announces itself over mDNS as `_fireverse._tcp`. Set ANNOUNCE=off to stay quiet.
 * Returns a function that withdraws the announcement.
 */
export function announceTable(port: number, campaign: string): (done?: () => void) => void {
  if (process.env.ANNOUNCE === "off") return (done) => done?.();
  try {
    const bonjour = new Bonjour({}, (err: Error) => console.warn(`Table announcement stopped: ${err.message}`));
    const host = os.hostname().split(".")[0] || "table";
    const name = `D20 FireVerse (${host})`;
    const service = bonjour.publish({ name, type: "fireverse", protocol: "tcp", port, txt: { campaign, path: "/" } });
    service.on("error", (err: Error) => console.warn(`Table announcement failed: ${err.message}`));
    console.log(`Announcing "${name}" on the local network (_fireverse._tcp) for the Fire TV app`);
    return (done) => bonjour.unpublishAll(() => {
      bonjour.destroy();
      done?.();
    });
  } catch (err) {
    console.warn(`Table announcement unavailable: ${err instanceof Error ? err.message : err}`);
    return (done) => done?.();
  }
}
