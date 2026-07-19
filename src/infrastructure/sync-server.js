import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError } from "../domain/errors.js";

function getOrCreateToken(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf8").trim();
  const token = randomBytes(24).toString("base64url");
  fs.writeFileSync(filePath, `${token}\n`, { encoding: "utf8", mode: 0o600 });
  return token;
}

function authorized(request, token) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/iu, "") || "";
  const expectedBuffer = Buffer.from(token);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(payload);
}

async function readJson(request, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new DomainError("Пакет синхронизации слишком большой", "PAYLOAD_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new DomainError("Некорректный JSON", "INVALID_JSON", 400); }
}

export function createSyncServer({ config, syncService, logger }) {
  if (!config.sync.enabled) return null;
  const token = getOrCreateToken(config.sync.tokenFile);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (request.method === "GET" && url.pathname === "/sync/v1/health") {
        return send(response, 200, { status: "ok", protocolVersion: 1 });
      }
      if (!authorized(request, token)) return send(response, 401, { error: { code: "UNAUTHORIZED", message: "Неверный токен синхронизации" } });
      if (request.method === "GET" && url.pathname === "/sync/v1/pull") {
        return send(response, 200, syncService.pull(url.searchParams.get("since")));
      }
      if (request.method === "POST" && url.pathname === "/sync/v1/push") {
        return send(response, 200, syncService.push(await readJson(request, config.maxRequestBytes * 8)));
      }
      send(response, 404, { error: { code: "NOT_FOUND", message: "Адрес синхронизации не найден" } });
    } catch (error) {
      const status = error instanceof DomainError ? error.status : 500;
      logger.error("sync.error", { path: url.pathname, status, error: error.message });
      send(response, status, { error: { code: error.code || "INTERNAL_ERROR", message: status === 500 ? "Ошибка синхронизации" : error.message } });
    }
  });
  return { server, tokenFile: config.sync.tokenFile };
}
