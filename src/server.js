import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./infrastructure/config.js";
import { openDatabase } from "./infrastructure/database.js";
import { JsonLogger } from "./infrastructure/logger.js";
import { SqliteRepository } from "./infrastructure/sqlite-repository.js";
import { RuleBasedDialogueAnalyzer } from "./application/dialogue-analyzer.js";
import { TaskManagerService } from "./application/task-manager-service.js";
import { BackupService } from "./application/backup-service.js";
import { SyncService } from "./application/sync-service.js";
import { createSyncServer } from "./infrastructure/sync-server.js";
import { DomainError } from "./domain/errors.js";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = loadConfig(rootDirectory);
const databasePath = path.join(config.dataDirectory, "tasks.sqlite");
const database = openDatabase(databasePath);
const logger = new JsonLogger(path.join(config.dataDirectory, "logs"));
const repository = new SqliteRepository(database);
const analyzer = new RuleBasedDialogueAnalyzer();
const service = new TaskManagerService({ repository, analyzer, author: config.author, logger });
const backupService = new BackupService({ database, backupDirectory: config.backupDirectory, logger });
const syncService = new SyncService({ repository, logger });
const sync = createSyncServer({ config, syncService, logger });

const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  response.end(payload);
}

function sendStatic(response, route) {
  const [fileName, contentType] = staticFiles.get(route);
  const content = fs.readFileSync(path.join(rootDirectory, "public", fileName));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": content.length,
    "Cache-Control": route === "/" ? "no-cache" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self'"
  });
  response.end(content);
}

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > config.maxRequestBytes) throw new DomainError("Запрос слишком большой", "PAYLOAD_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("Некорректный JSON", "INVALID_JSON", 400);
  }
}

function taskFilters(url) {
  return {
    projectId: url.searchParams.get("projectId") || undefined,
    status: url.searchParams.get("status") || undefined,
    parentTaskId: url.searchParams.has("rootOnly") ? null : undefined,
    limit: url.searchParams.get("limit") || undefined
  };
}

async function handleApi(request, response, url) {
  const method = request.method;
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok", version: "0.2.0", storage: "sqlite", androidSync: Boolean(sync) });
  }
  if (method === "GET" && pathname === "/api/bootstrap") {
    return sendJson(response, 200, service.bootstrap());
  }
  if (method === "GET" && pathname === "/api/dashboard") {
    return sendJson(response, 200, service.dashboard());
  }
  if (method === "GET" && pathname === "/api/projects") {
    return sendJson(response, 200, service.listProjects({ status: url.searchParams.get("status") || undefined }));
  }
  if (method === "POST" && pathname === "/api/projects") {
    return sendJson(response, 201, service.createProject(await readJson(request)));
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([0-9a-f-]+)$/iu);
  if (method === "PATCH" && projectMatch) {
    return sendJson(response, 200, service.updateProject(projectMatch[1], await readJson(request)));
  }
  if (method === "GET" && pathname === "/api/tasks") {
    return sendJson(response, 200, service.listTasks(taskFilters(url)));
  }
  if (method === "POST" && pathname === "/api/tasks") {
    return sendJson(response, 201, service.createTask(await readJson(request)));
  }
  const taskMatch = pathname.match(/^\/api\/tasks\/([0-9a-f-]+)$/iu);
  if (method === "PATCH" && taskMatch) {
    return sendJson(response, 200, service.updateTask(taskMatch[1], await readJson(request)));
  }
  if (method === "GET" && pathname === "/api/dialogues") {
    return sendJson(response, 200, service.listDialogues(url.searchParams.get("limit")));
  }
  if (method === "POST" && pathname === "/api/dialogue/analyze") {
    const body = await readJson(request);
    return sendJson(response, 200, service.processDialogue(body.text, { projectId: body.projectId }));
  }
  if (method === "GET" && pathname === "/api/search") {
    return sendJson(response, 200, service.search(url.searchParams.get("q")));
  }
  if (method === "GET" && pathname === "/api/activity") {
    return sendJson(response, 200, service.listActivity(url.searchParams.get("limit")));
  }
  if (method === "POST" && pathname === "/api/backups") {
    return sendJson(response, 201, await backupService.create());
  }
  return sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Адрес API не найден" } });
}

const server = http.createServer(async (request, response) => {
  const startedAt = performance.now();
  const url = new URL(request.url, `http://${request.headers.host || `${config.host}:${config.port}`}`);
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url);
    else if (request.method === "GET" && staticFiles.has(url.pathname)) sendStatic(response, url.pathname);
    else sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Страница не найдена" } });
    logger.info("http.request", { method: request.method, path: url.pathname, status: response.statusCode, durationMs: Math.round(performance.now() - startedAt) });
  } catch (error) {
    const status = error instanceof DomainError ? error.status : 500;
    logger.error("http.error", { method: request.method, path: url.pathname, status, error: error.message, stack: status === 500 ? error.stack : undefined });
    if (!response.headersSent) {
      sendJson(response, status, {
        error: { code: error.code || "INTERNAL_ERROR", message: status === 500 ? "Внутренняя ошибка приложения" : error.message, details: error.details }
      });
    } else response.end();
  }
});

server.listen(config.port, config.host, () => {
  logger.info("application.started", { host: config.host, port: config.port, databasePath });
  console.log(`ИИ-менеджер задач запущен: http://${config.host}:${config.port}`);
});

if (sync) {
  sync.server.listen(config.sync.port, config.sync.host, () => {
    logger.info("sync.started", { host: config.sync.host, port: config.sync.port, tokenFile: sync.tokenFile });
    console.log(`Синхронизация Android: порт ${config.sync.port}; токен: ${sync.tokenFile}`);
  });
}

function shutdown(signal) {
  logger.info("application.stopping", { signal });
  let pending = sync ? 2 : 1;
  const closed = () => {
    pending -= 1;
    if (pending === 0) {
      database.close();
      process.exit(0);
    }
  };
  server.close(closed);
  if (sync) sync.server.close(closed);
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
