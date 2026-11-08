"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "splitpot.json");
const MAX_BODY_BYTES = 1024 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function validData(d) {
  return !!(d && typeof d === "object" &&
    typeof d.title === "string" &&
    Array.isArray(d.members) &&
    d.members.every((m) => typeof m === "string" && m.trim()) &&
    Array.isArray(d.expenses) &&
    d.expenses.every((x) => x && typeof x === "object" &&
      typeof x.title === "string" &&
      Number.isFinite(Number(x.amount)) &&
      typeof x.payer === "string" &&
      Array.isArray(x.participants) &&
      x.participants.length > 0 &&
      x.participants.every((p) => typeof p === "string")) &&
    (d.payments === undefined ||
      (Array.isArray(d.payments) &&
        d.payments.every((p) => p && typeof p === "object" &&
          typeof p.from === "string" &&
          typeof p.to === "string" &&
          Number.isFinite(Number(p.amount))))));
}

async function readData() {
  try {
    const raw = await fsp.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return validData(parsed) ? parsed : null;
  } catch (err) {
    if (err.code !== "ENOENT") console.error("Fehler beim Lesen der Datendatei:", err.message);
    return null;
  }
}

async function writeDataAtomic(data) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + ".tmp";
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fsp.rename(tmp, DATA_FILE);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  if (req.method === "GET" && req.url.split("?")[0] === "/api/data") {
    const data = await readData();
    return sendJson(res, 200, { data });
  }
  if (req.method === "PUT" && req.url.split("?")[0] === "/api/data") {
    let parsed;
    try {
      parsed = JSON.parse(await readBody(req));
    } catch (err) {
      return sendJson(res, 400, { error: "Ungültiges JSON" });
    }
    if (!validData(parsed)) {
      return sendJson(res, 422, { error: "Daten entsprechen nicht dem erwarteten Format" });
    }
    try {
      await writeDataAtomic(parsed);
    } catch (err) {
      console.error("Fehler beim Schreiben der Datendatei:", err.message);
      return sendJson(res, 500, { error: "Speichern fehlgeschlagen" });
    }
    return sendJson(res, 204);
  }
  return sendJson(res, 404, { error: "Nicht gefunden" });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    return res.end();
  }
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error("no file");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=3600"
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 – nicht gefunden");
  }
}

const server = http.createServer((req, res) => {
  const handler = req.url.startsWith("/api/") ? handleApi : serveStatic;
  handler(req, res).catch((err) => {
    console.error("Serverfehler:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("500 – interner Serverfehler");
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Split Pot läuft auf http://${HOST}:${PORT} (Daten: ${DATA_FILE})`);
});
