import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/infrastructure/database.js";
import { SqliteRepository } from "../src/infrastructure/sqlite-repository.js";
import { NullLogger } from "../src/infrastructure/logger.js";
import { RuleBasedDialogueAnalyzer } from "../src/application/dialogue-analyzer.js";
import { TaskManagerService } from "../src/application/task-manager-service.js";
import { BackupService } from "../src/application/backup-service.js";
import { SyncService } from "../src/application/sync-service.js";
import { GoogleSheetsSyncService } from "../src/application/google-sheets-sync-service.js";
import { GoogleOAuthService } from "../src/application/google-oauth-service.js";
import { GoogleSheetsApiService } from "../src/application/google-sheets-api-service.js";
import { NotFoundError, ValidationError } from "../src/domain/errors.js";

const resources = [];
const FIXED_DATE = new Date("2026-07-19T09:00:00.000Z");

function setup(clock = () => new Date(FIXED_DATE)) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "orbita-test-"));
  const databasePath = path.join(directory, "test.sqlite");
  const database = openDatabase(databasePath);
  const repository = new SqliteRepository(database);
  const logger = new NullLogger();
  const analyzer = new RuleBasedDialogueAnalyzer({ clock });
  const service = new TaskManagerService({ repository, analyzer, author: "Тест", clock, logger });
  resources.push({ database, directory });
  return { service, repository, database, directory, databasePath, logger };
}

afterEach(() => {
  while (resources.length) {
    const resource = resources.pop();
    try { resource.database.close(); } catch {}
    fs.rmSync(resource.directory, { recursive: true, force: true });
  }
});

test("создаёт проект и записывает действие в журнал", () => {
  const { service } = setup();
  const project = service.createProject({ title: "Судебные дела", description: "Рабочие процессы" });

  assert.equal(project.title, "Судебные дела");
  assert.equal(project.status, "active");
  assert.equal(service.listProjects().length, 1);
  assert.equal(service.listActivity()[0].action, "created");
});

test("не позволяет создать проект без названия", () => {
  const { service } = setup();
  assert.throws(() => service.createProject({ title: "  " }), ValidationError);
});

test("создаёт задачу и подзадачу с корректными связями", () => {
  const { service } = setup();
  const project = service.createProject({ title: "Проект" });
  const parent = service.createTask({ title: "Подготовить иск", projectId: project.id, priority: "high" });
  const child = service.createTask({ title: "Проверить доказательства", projectId: project.id, parentTaskId: parent.id });

  assert.equal(child.parentTaskId, parent.id);
  assert.equal(service.listTasks().length, 2);
  assert.equal(service.listTasks().find(task => task.id === parent.id).subtaskCount, 1);
});

test("отклоняет задачу с неизвестным проектом", () => {
  const { service } = setup();
  assert.throws(() => service.createTask({ title: "Задача", projectId: "missing" }), NotFoundError);
});

test("разбирает голосовую команду с приоритетом и сроком", () => {
  const { service } = setup();
  const result = service.processDialogue("Задача: срочно подготовить отзыв до завтра");

  assert.equal(result.analysis.intent, "create_task");
  assert.equal(result.data.title, "подготовить отзыв");
  assert.equal(result.data.priority, "urgent");
  assert.ok(result.data.dueAt);
  assert.equal(service.listDialogues().length, 2);
});

test("завершает задачу естественной командой", () => {
  const { service } = setup();
  const task = service.createTask({ title: "Позвонить клиенту" });
  const result = service.processDialogue("Заверши задачу Позвонить клиенту");

  assert.equal(result.data.id, task.id);
  assert.equal(result.data.status, "done");
  assert.ok(result.data.completedAt);
});

test("формирует план из просроченных и сегодняшних задач", () => {
  const { service } = setup();
  service.createTask({ title: "Просроченная", dueAt: "2026-07-18T10:00:00.000Z" });
  service.createTask({ title: "Сегодня", dueAt: FIXED_DATE.toISOString() });
  service.createTask({ title: "Без срока" });

  const result = service.processDialogue("Что у меня на сегодня?");
  assert.equal(result.analysis.intent, "daily_plan");
  assert.equal(result.data.length, 2);
  assert.equal(service.dashboard().stats.overdueTasks, 1);
});

test("ищет одновременно по проектам, задачам и диалогам", () => {
  const { service } = setup();
  service.createProject({ title: "Альфа" });
  service.createTask({ title: "Письмо Альфа-Банку" });
  service.processDialogue("Найди Альфа");

  const results = service.search("Альфа");
  assert.ok(results.some(item => item.type === "project"));
  assert.ok(results.some(item => item.type === "task"));
  assert.ok(results.some(item => item.type === "dialogue"));
});

test("сохраняет данные после повторного открытия базы", () => {
  const setupResult = setup();
  setupResult.service.createTask({ title: "Пережить перезапуск" });
  setupResult.database.close();
  resources.pop();

  const reopened = openDatabase(setupResult.databasePath);
  const repository = new SqliteRepository(reopened);
  assert.equal(repository.listTasks()[0].title, "Пережить перезапуск");
  reopened.close();
  fs.rmSync(setupResult.directory, { recursive: true, force: true });
});

test("создаёт консистентную резервную копию SQLite", async () => {
  const { service, database, directory, logger } = setup();
  service.createTask({ title: "Сохранить в резервной копии" });
  const backupDirectory = path.join(directory, "backups");
  const backupService = new BackupService({ database, backupDirectory, logger });

  const result = await backupService.create();
  const backupDatabase = openDatabase(path.join(backupDirectory, result.fileName));
  const backupRepository = new SqliteRepository(backupDatabase);
  assert.equal(backupRepository.listTasks().length, 1);
  backupDatabase.close();
});

test("синхронизирует Android-проект и задачу по правилу последнего изменения", () => {
  const { repository, logger } = setup();
  const sync = new SyncService({ repository, logger, clock: () => new Date(FIXED_DATE) });
  const projectId = "2eb16e37-a741-4a63-8eae-f1d8e8f63e5a";
  const taskId = "2d32e22b-5d60-44b0-aa5f-7629e66c94cf";
  const createdAt = "2026-07-18T08:00:00.000Z";

  const first = sync.push({
    deviceId: "android-test",
    projects: [{ id: projectId, title: "Мобильный проект", status: "active", color: "#6C5CE7", author: "Android", createdAt, updatedAt: createdAt }],
    tasks: [{ id: taskId, projectId, title: "Задача с телефона", status: "todo", priority: "high", author: "Android", createdAt, updatedAt: createdAt }]
  });
  assert.deepEqual(first.applied, { projects: 1, tasks: 1 });

  const stale = sync.push({
    deviceId: "android-test",
    projects: [],
    tasks: [{ id: taskId, projectId, title: "Устаревшее название", status: "todo", priority: "normal", author: "Android", createdAt, updatedAt: "2026-07-17T08:00:00.000Z" }]
  });
  assert.deepEqual(stale.applied, { projects: 0, tasks: 0 });
  assert.equal(repository.getTask(taskId).title, "Задача с телефона");

  const pull = sync.pull("1970-01-01T00:00:00.000Z");
  assert.equal(pull.projects.length, 1);
  assert.equal(pull.tasks.length, 1);
  assert.equal(pull.protocolVersion, 1);
});

test("обменивается задачами с Google Таблицей и не передаёт секрет в журнал", async () => {
  const { service, repository, logger, directory } = setup();
  const localTask = service.createTask({ title: "Локальная задача" });
  const credentialsFile = path.join(directory, "google-sheets-sync.json");
  fs.writeFileSync(credentialsFile, JSON.stringify({
    webAppUrl: "https://script.google.com/macros/s/test-deployment_123/exec",
    secret: "test-secret-with-at-least-24-characters"
  }));
  const remoteTask = {
    id: "7a48e88a-0be0-46df-8820-2c1be87ded77",
    projectId: null,
    parentTaskId: null,
    title: "Задача от ChatGPT",
    description: "Добавлена через единую таблицу",
    status: "todo",
    priority: "high",
    dueAt: null,
    completedAt: null,
    author: "ChatGPT",
    createdAt: "2026-07-19T08:00:00.000Z",
    updatedAt: "2026-07-19T10:00:00.000Z"
  };
  let sent;
  const google = new GoogleSheetsSyncService({
    config: { googleSheets: { enabled: true, credentialsFile, intervalSeconds: 300, debounceMilliseconds: 100 } },
    syncService: new SyncService({ repository, logger, clock: () => new Date(FIXED_DATE) }),
    logger,
    clock: () => new Date(FIXED_DATE),
    fetchImpl: async (_url, options) => {
      sent = JSON.parse(options.body);
      return new Response(JSON.stringify({
        ok: true,
        serverTime: FIXED_DATE.toISOString(),
        projects: [],
        tasks: [sent.tasks.find(task => task.id === localTask.id), remoteTask]
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });

  const status = await google.synchronize("test");

  assert.equal(sent.action, "sync");
  assert.equal(sent.tasks[0].title, "Локальная задача");
  assert.equal(repository.getTask(remoteTask.id).title, "Задача от ChatGPT");
  assert.equal(status.tasks, 2);
  assert.equal(status.lastError, null);
  google.close();
});

test("выполняет Desktop OAuth через PKCE без client secret", async () => {
  let saved = null;
  const tokenStore = {
    load: () => saved,
    save: value => { saved = value; },
    clear: () => { saved = null; }
  };
  const requests = [];
  const oauth = new GoogleOAuthService({
    config: { googleOAuth: {
      enabled: true,
      clientId: "desktop-client.apps.googleusercontent.com",
      redirectUri: "http://127.0.0.1:3765/api/google/oauth/callback"
    } },
    tokenStore,
    logger: new NullLogger(),
    clock: () => new Date(FIXED_DATE),
    fetchImpl: async (url, options = {}) => {
      requests.push({ url, options });
      if (String(url).includes("/token")) {
        return new Response(JSON.stringify({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600, scope: "openid email" }), { status: 200 });
      }
      return new Response(JSON.stringify({ email: "user@example.com", name: "Пользователь" }), { status: 200 });
    }
  });

  const started = oauth.begin();
  const authorizationUrl = new URL(started.authorizationUrl);
  assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorizationUrl.searchParams.get("code_challenge"));
  assert.equal(authorizationUrl.searchParams.get("client_secret"), null);

  const result = await oauth.complete({ code: "authorization-code", state: authorizationUrl.searchParams.get("state") });
  const tokenBody = requests[0].options.body;
  assert.ok(tokenBody.get("code_verifier"));
  assert.equal(tokenBody.get("client_secret"), null);
  assert.equal(result.account.email, "user@example.com");
  assert.equal(saved.refreshToken, "refresh-1");
});

test("синхронизирует SQLite с Google Sheets API после OAuth", async () => {
  const { service, repository, logger, directory } = setup();
  service.createTask({ title: "Локальная OAuth-задача" });
  const spreadsheetFile = path.join(directory, "spreadsheet.json");
  fs.writeFileSync(spreadsheetFile, JSON.stringify({ spreadsheetId: "spreadsheet_12345678901234567890", title: "Орбита", url: "https://example.test/sheet" }));
  const remoteId = "0ecb64d0-b88d-423b-9931-9be0777bb1b7";
  let written = null;
  const api = new GoogleSheetsApiService({
    config: { googleOAuth: { spreadsheetFile } },
    oauth: { status: () => ({ connected: true, account: { email: "user@example.com" } }), accessToken: async () => "access" },
    syncService: new SyncService({ repository, logger, clock: () => new Date(FIXED_DATE) }),
    logger,
    clock: () => new Date(FIXED_DATE),
    fetchImpl: async (url, options = {}) => {
      if (String(url).includes("values:batchGet")) {
        return new Response(JSON.stringify({ valueRanges: [
          { values: [] },
          { values: [[remoteId, "", "", "", "Задача из OAuth-таблицы", "", "todo", "high", "", "", "ChatGPT", "2026-07-19T08:00:00.000Z", "2026-07-19T09:00:00.000Z", "Google Sheets", ""]] }
        ] }), { status: 200 });
      }
      if (String(url).includes("values:batchUpdate")) written = JSON.parse(options.body);
      return new Response(JSON.stringify({}), { status: 200 });
    }
  });

  const result = await api.synchronize("test");

  assert.equal(repository.getTask(remoteId).title, "Задача из OAuth-таблицы");
  assert.equal(result.mode, "oauth");
  assert.equal(result.tasks, 2);
  assert.ok(written.data.find(item => item.range === "Tasks!A2:O").values.some(row => row[4] === "Локальная OAuth-задача"));
});
