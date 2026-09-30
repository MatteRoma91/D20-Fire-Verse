/**
 * Username/password accounts. The first boot seeds admin / admin.
 * Sessions are an httpOnly cookie the WebSocket upgrade sends on its own.
 */

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DATA_DIR } from "./paths.js";

export type Role = "admin" | "player";

export type SessionUser = {
  id: string;
  username: string;
  role: Role;
  disabled: boolean;
};

const COOKIE = "fv_session";

let db: DatabaseSync | null = null;

function database(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(path.join(DATA_DIR, "accounts.sqlite"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n === 0) {
    createUser("admin", "admin", "admin");
  }
  return db;
}

export function openAuth(): void {
  database();
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")): string {
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function passwordMatches(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const got = scryptSync(password, salt, 32);
  const want = Buffer.from(hash, "hex");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export function createUser(username: string, password: string, role: Role = "player"): SessionUser {
  const name = username.trim();
  if (!/^[a-zA-Z0-9._-]{2,32}$/.test(name)) throw new Error("BAD_USERNAME");
  if (password.length < 4) throw new Error("BAD_PASSWORD");
  if (role !== "admin" && role !== "player") throw new Error("BAD_ROLE");
  const id = `user_${randomBytes(8).toString("hex")}`;
  try {
    database()
      .prepare("INSERT INTO users (id, username, password, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)")
      .run(id, name, hashPassword(password), role, new Date().toISOString());
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new Error("USERNAME_TAKEN");
    throw err;
  }
  return { id, username: name, role, disabled: false };
}

export function listUsers(): SessionUser[] {
  const rows = database()
    .prepare("SELECT id, username, role, disabled FROM users ORDER BY username COLLATE NOCASE")
    .all() as Array<{ id: string; username: string; role: Role; disabled: number }>;
  return rows.map((r) => ({ id: r.id, username: r.username, role: r.role, disabled: r.disabled === 1 }));
}

export function updateUser(
  id: string,
  patch: { password?: string; role?: Role; disabled?: boolean },
): SessionUser {
  const row = database().prepare("SELECT id, username, role, disabled FROM users WHERE id = ?").get(id) as
    | { id: string; username: string; role: Role; disabled: number }
    | undefined;
  if (!row) throw new Error("USER_NOT_FOUND");
  if (patch.password !== undefined) {
    if (patch.password.length < 4) throw new Error("BAD_PASSWORD");
    database().prepare("UPDATE users SET password = ? WHERE id = ?").run(hashPassword(patch.password), id);
  }
  if (patch.role !== undefined) {
    if (patch.role !== "admin" && patch.role !== "player") throw new Error("BAD_ROLE");
    database().prepare("UPDATE users SET role = ? WHERE id = ?").run(patch.role, id);
  }
  if (patch.disabled !== undefined) {
    database().prepare("UPDATE users SET disabled = ? WHERE id = ?").run(patch.disabled ? 1 : 0, id);
    if (patch.disabled) database().prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  }
  const next = database().prepare("SELECT id, username, role, disabled FROM users WHERE id = ?").get(id) as {
    id: string;
    username: string;
    role: Role;
    disabled: number;
  };
  return { id: next.id, username: next.username, role: next.role, disabled: next.disabled === 1 };
}

export function login(username: string, password: string): { token: string; user: SessionUser } | null {
  const row = database()
    .prepare("SELECT id, username, password, role, disabled FROM users WHERE username = ? COLLATE NOCASE")
    .get(username.trim()) as
    | { id: string; username: string; password: string; role: Role; disabled: number }
    | undefined;
  if (!row || row.disabled || !passwordMatches(password, row.password)) return null;
  const token = randomBytes(32).toString("hex");
  database().prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, row.id, new Date().toISOString());
  return {
    token,
    user: { id: row.id, username: row.username, role: row.role, disabled: false },
  };
}

export function logout(token: string | null): void {
  if (!token) return;
  database().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function userFromToken(token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  const row = database()
    .prepare(
      `SELECT u.id, u.username, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`,
    )
    .get(token) as { id: string; username: string; role: Role; disabled: number } | undefined;
  if (!row || row.disabled) return null;
  return { id: row.id, username: row.username, role: row.role, disabled: false };
}

export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const bits = [`${COOKIE}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=2592000"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

export function clearSessionCookie(secure: boolean): string {
  const bits = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) bits.push("Secure");
  return bits.join("; ");
}

/** Game actions need a signed-in player. A ping may arrive before the cookie is checked. */
export function actionNeedsAuth(action: string): boolean {
  return action !== "PING";
}

export function assertAdmin(user: SessionUser | null): SessionUser {
  if (!user) throw new Error("AUTH_REQUIRED");
  if (user.role !== "admin" || user.disabled) throw new Error("FORBIDDEN");
  return user;
}
