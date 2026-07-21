import {
  IDEA_STATUSES, oneOf, optionalIsoDate, optionalText, PROJECT_STATUSES, requireText,
  TASK_PRIORITIES, TASK_STATUSES, taskTiming
} from "../domain/model.js";
import { ValidationError } from "../domain/errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function id(value, field) {
  if (!UUID.test(value ?? "")) throw new ValidationError(`Некорректный идентификатор: ${field}`);
  return value.toLowerCase();
}

function timestamp(value, field) {
  const parsed = optionalIsoDate(value, field);
  if (!parsed) throw new ValidationError(`Поле «${field}» обязательно`);
  return parsed;
}

function safeAuthor(value) {
  return requireText(value || "Android", "Автор", 120);
}

export class SyncService {
  constructor({ repository, logger, clock = () => new Date() }) {
    this.repository = repository;
    this.logger = logger;
    this.clock = clock;
  }

  pull(sinceValue) {
    const since = sinceValue ? optionalIsoDate(sinceValue, "since") : "1970-01-01T00:00:00.000Z";
    return {
      protocolVersion: 1,
      serverTime: this.clock().toISOString(),
      projects: this.repository.listProjectsChangedSince(since),
      tasks: this.repository.listTasksChangedSince(since),
      ideas: this.repository.listIdeasChangedSince(since)
    };
  }

  push(payload) {
    if (!payload || typeof payload !== "object") throw new ValidationError("Пустой пакет синхронизации");
    const projects = Array.isArray(payload.projects) ? payload.projects.map(item => this.project(item)) : [];
    const tasks = Array.isArray(payload.tasks) ? payload.tasks.map(item => this.task(item)) : [];
    const ideas = Array.isArray(payload.ideas) ? payload.ideas.map(item => this.idea(item)) : [];
    if (projects.length > 1000 || tasks.length > 5000 || ideas.length > 5000) throw new ValidationError("Слишком большой пакет синхронизации");

    const applied = this.repository.transaction(() => {
      let projectCount = 0;
      let taskCount = 0;
      let ideaCount = 0;
      for (const project of projects) projectCount += this.repository.upsertSyncedProject(project);
      for (const task of tasks) taskCount += this.repository.upsertSyncedTask(task);
      for (const idea of ideas) ideaCount += this.repository.upsertSyncedIdea(idea);
      this.repository.addActivity({
        entityType: "sync",
        entityId: payload.deviceId ? String(payload.deviceId).slice(0, 120) : null,
        action: "synchronized",
        details: {
          receivedProjects: projects.length, receivedTasks: tasks.length, receivedIdeas: ideas.length,
          appliedProjects: projectCount, appliedTasks: taskCount, appliedIdeas: ideaCount
        },
        author: "Android",
        createdAt: this.clock().toISOString()
      });
      return { projects: projectCount, tasks: taskCount, ideas: ideaCount };
    });
    this.logger.info("sync.push", { deviceId: payload.deviceId, ...applied });
    return { protocolVersion: 1, serverTime: this.clock().toISOString(), applied };
  }

  project(item) {
    return {
      id: id(item.id, "project.id"),
      title: requireText(item.title, "Название проекта", 200),
      description: optionalText(item.description),
      status: oneOf(item.status, PROJECT_STATUSES, "Статус проекта", "active"),
      color: /^#[0-9a-f]{6}$/iu.test(item.color ?? "") ? item.color : "#6C5CE7",
      author: safeAuthor(item.author),
      createdAt: timestamp(item.createdAt, "project.createdAt"),
      updatedAt: timestamp(item.updatedAt, "project.updatedAt")
    };
  }

  task(item) {
    const timing = taskTiming({ urgency: item.urgency, dueAt: item.dueAt, clock: this.clock });
    return {
      id: id(item.id, "task.id"),
      projectId: item.projectId ? id(item.projectId, "task.projectId") : null,
      parentTaskId: item.parentTaskId ? id(item.parentTaskId, "task.parentTaskId") : null,
      title: requireText(item.title, "Название задачи", 300),
      description: optionalText(item.description),
      status: oneOf(item.status, TASK_STATUSES, "Статус задачи", "todo"),
      priority: oneOf(item.priority, TASK_PRIORITIES, "Приоритет", "normal"),
      urgency: timing.urgency,
      dueAt: timing.dueAt,
      completedAt: optionalIsoDate(item.completedAt),
      author: safeAuthor(item.author),
      createdAt: timestamp(item.createdAt, "task.createdAt"),
      updatedAt: timestamp(item.updatedAt, "task.updatedAt")
    };
  }

  idea(item) {
    return {
      id: id(item.id, "idea.id"),
      title: requireText(item.title, "Название идеи", 300),
      description: optionalText(item.description),
      status: oneOf(item.status, IDEA_STATUSES, "Статус идеи", "new"),
      projectId: item.projectId ? id(item.projectId, "idea.projectId") : null,
      author: safeAuthor(item.author),
      createdAt: timestamp(item.createdAt, "idea.createdAt"),
      updatedAt: timestamp(item.updatedAt, "idea.updatedAt")
    };
  }
}
