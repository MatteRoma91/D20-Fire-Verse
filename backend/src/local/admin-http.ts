import type { Express, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAdmin,
  clearSessionCookie,
  createUser,
  listUsers,
  login,
  logout,
  openAuth,
  readSessionCookie,
  sessionCookie,
  updateUser,
  userFromToken,
  type Role,
  type SessionUser,
} from "./auth.js";
import {
  artDirFor,
  draftSnapshot,
  importCampaignZip,
  listCampaigns,
  listPublished,
  publishCampaign,
  unpublishCampaign,
  updateDraftEncounter,
  updateDraftNode,
} from "./catalog.js";
import type { EncounterDef, StoryNode } from "./campaign.js";
import { closeRoom, listRooms, listSaves } from "./room.js";

const page = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "admin.html"), "utf8");

function secure(req: Request): boolean {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

export function requestUser(req: { headers: { cookie?: string | string[] | undefined } }): SessionUser | null {
  const cookie = Array.isArray(req.headers.cookie) ? req.headers.cookie.join(";") : req.headers.cookie;
  return userFromToken(readSessionCookie(cookie));
}

function fail(res: Response, err: unknown): void {
  const code = err instanceof Error ? err.message : "ERROR";
  const status = code === "AUTH_REQUIRED" ? 401 : code === "FORBIDDEN" ? 403 : 400;
  res.status(status).json({ error: code });
}

export function mountAccountRoutes(app: Express): void {
  openAuth();

  app.post("/api/login", (req, res) => {
    const username = String(req.body?.username ?? "");
    const password = String(req.body?.password ?? "");
    const found = login(username, password);
    if (!found) {
      res.status(401).json({ error: "BAD_LOGIN" });
      return;
    }
    res.setHeader("Set-Cookie", sessionCookie(found.token, secure(req)));
    res.json({ user: found.user });
  });

  app.post("/api/logout", (req, res) => {
    logout(readSessionCookie(req.headers.cookie));
    res.setHeader("Set-Cookie", clearSessionCookie(secure(req)));
    res.json({ ok: true });
  });

  app.get("/api/me", (req, res) => {
    const user = requestUser(req);
    if (!user) {
      res.status(401).json({ error: "AUTH_REQUIRED" });
      return;
    }
    res.json({ user });
  });

  app.get("/api/campaigns", (_req, res) => {
    res.json({ campaigns: listPublished() });
  });

  app.use("/campaigns/:id/art", (req, res, next) => {
    const dir = artDirFor(String(req.params.id));
    if (!dir) {
      next();
      return;
    }
    const rel = req.path.replace(/^\/+/, "");
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.status(404).end();
      return;
    }
    res.sendFile(file);
  });
}

export function handleCampaignImport(req: Request, res: Response): void {
  try {
    assertAdmin(requestUser(req));
    const buf = req.body;
    if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error("BAD_ZIP");
    const draft = importCampaignZip(buf);
    res.json({ id: draft.id, title: draft.manifest.title });
  } catch (err) {
    fail(res, err);
  }
}

export function mountAdminRoutes(app: Express): void {
  app.get("/admin", (_req, res) => {
    res.type("html").send(page);
  });

  app.get("/api/admin/users", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      res.json({ users: listUsers() });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/admin/users", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      const role = (req.body?.role === "admin" ? "admin" : "player") as Role;
      res.json({ user: createUser(String(req.body?.username ?? ""), String(req.body?.password ?? ""), role) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/admin/users/:id", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      const patch: { password?: string; role?: Role; disabled?: boolean } = {};
      if (typeof req.body?.password === "string" && req.body.password) patch.password = req.body.password;
      if (req.body?.role === "admin" || req.body?.role === "player") patch.role = req.body.role;
      if (typeof req.body?.disabled === "boolean") patch.disabled = req.body.disabled;
      res.json({ user: updateUser(String(req.params.id), patch) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/admin/rooms", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      res.json({ rooms: listRooms() });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/admin/rooms/:code/close", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      closeRoom(String(req.params.code));
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/admin/saves", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      res.json({ saves: listSaves() });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/admin/campaigns", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      res.json({ campaigns: listCampaigns() });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/admin/campaigns/:id", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      const draft = draftSnapshot(String(req.params.id));
      res.json({
        id: draft.id,
        manifest: draft.manifest,
        nodes: Object.values(draft.nodes).map((n) => ({ id: n.id, type: n.type })),
        encounters: Object.values(draft.encounters).map((e) => ({ id: e.id, name: e.name })),
      });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/admin/campaigns/:id/nodes/:nodeId", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      const draft = draftSnapshot(String(req.params.id));
      const node = draft.nodes[String(req.params.nodeId)];
      if (!node) {
        res.status(404).json({ error: "BAD_NODE" });
        return;
      }
      const encounter = node.encounterId ? draft.encounters[node.encounterId] : undefined;
      res.json({ node, encounter: encounter ?? null });
    } catch (err) {
      fail(res, err);
    }
  });

  app.put("/api/admin/campaigns/:id/nodes/:nodeId", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      const node = req.body?.node as StoryNode;
      if (!node || node.id !== req.params.nodeId) throw new Error("BAD_NODE");
      updateDraftNode(String(req.params.id), node);
      if (req.body?.encounter) updateDraftEncounter(String(req.params.id), req.body.encounter as EncounterDef);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/admin/campaigns/:id/publish", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      const snap = publishCampaign(String(req.params.id));
      res.json({ id: snap.id, version: snap.version });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/admin/campaigns/:id/unpublish", (req, res) => {
    try {
      assertAdmin(requestUser(req));
      unpublishCampaign(String(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });
}
