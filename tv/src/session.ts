/** The seat this television holds, so a reload or Wi-Fi drop walks straight back to the table. */

export type Session = {
  roomCode: string;
  playerId: string | null;
  hero?: string;
  place?: string;
  autosaveId?: string | null;
  savedAt: number;
};

const KEY = "fireverse.session.v1";
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (!s.roomCode || Date.now() - s.savedAt > MAX_AGE_MS) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(patch: Partial<Session> & { roomCode: string }) {
  const prev = loadSession();
  const next: Session = {
    ...(prev?.roomCode === patch.roomCode ? prev : { playerId: null }),
    ...patch,
    savedAt: Date.now(),
  } as Session;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private mode */
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
}
