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
  service.createTask({ title: "Сегодня", dueAt: "2026-07-19T15:00:00.000Z" });
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
