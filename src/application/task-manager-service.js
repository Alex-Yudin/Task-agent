import {
  nowIso, oneOf, optionalIsoDate, optionalText, PROJECT_STATUSES,
  requireText, TASK_PRIORITIES, TASK_STATUSES
} from "../domain/model.js";
import { NotFoundError, ValidationError } from "../domain/errors.js";

const PROJECT_COLORS = ["#6C5CE7", "#00A8A8", "#F2994A", "#D85C70", "#3D7EFF", "#7A9E35"];

function dayBounds(clock) {
  const now = new Date(clock());
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { now: now.toISOString(), startOfDay: start.toISOString(), endOfDay: end.toISOString() };
}

export class TaskManagerService {
  constructor({ repository, analyzer, author = "Локальный пользователь", clock = () => new Date(), logger }) {
    this.repository = repository;
    this.analyzer = analyzer;
    this.author = author;
    this.clock = clock;
    this.logger = logger;
  }

  createProject(input) {
    const timestamp = nowIso(this.clock);
    const title = requireText(input.title, "Название проекта", 200);
    const project = {
      id: this.repository.newId(),
      title,
      description: optionalText(input.description),
      status: oneOf(input.status, PROJECT_STATUSES, "Статус", "active"),
      color: /^#[0-9a-f]{6}$/iu.test(input.color ?? "")
        ? input.color
        : PROJECT_COLORS[this.repository.listProjects().length % PROJECT_COLORS.length],
      author: this.author,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const created = this.repository.transaction(() => {
      const result = this.repository.createProject(project);
      this.activity("project", project.id, "created", { title });
      return result;
    });
    this.logger.info("project.created", { projectId: project.id });
    return created;
  }

  updateProject(id, input) {
    const current = this.repository.getProject(id);
    if (!current) throw new NotFoundError("Проект", id);
    const changes = { updatedAt: nowIso(this.clock) };
    if (input.title !== undefined) changes.title = requireText(input.title, "Название проекта", 200);
    if (input.description !== undefined) changes.description = optionalText(input.description);
    if (input.status !== undefined) changes.status = oneOf(input.status, PROJECT_STATUSES, "Статус");
    if (input.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/iu.test(input.color)) throw new ValidationError("Некорректный цвет проекта");
      changes.color = input.color;
    }
    return this.repository.transaction(() => {
      const updated = this.repository.updateProject(id, changes);
      this.activity("project", id, "updated", changes);
      return updated;
    });
  }

  createTask(input) {
    const timestamp = nowIso(this.clock);
    const projectId = input.projectId || null;
    const parentTaskId = input.parentTaskId || null;
    if (projectId && !this.repository.getProject(projectId)) throw new NotFoundError("Проект", projectId);
    if (parentTaskId && !this.repository.getTask(parentTaskId)) throw new NotFoundError("Родительская задача", parentTaskId);
    const task = {
      id: this.repository.newId(),
      projectId,
      parentTaskId,
      title: requireText(input.title, "Название задачи", 300),
      description: optionalText(input.description),
      status: oneOf(input.status, TASK_STATUSES, "Статус", "todo"),
      priority: oneOf(input.priority, TASK_PRIORITIES, "Приоритет", "normal"),
      dueAt: optionalIsoDate(input.dueAt),
      completedAt: input.status === "done" ? timestamp : null,
      author: this.author,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const created = this.repository.transaction(() => {
      const result = this.repository.createTask(task);
      this.activity("task", task.id, "created", { title: task.title, projectId });
      return result;
    });
    this.logger.info("task.created", { taskId: task.id, projectId });
    return created;
  }

  updateTask(id, input) {
    const current = this.repository.getTask(id);
    if (!current) throw new NotFoundError("Задача", id);
    const changes = { updatedAt: nowIso(this.clock) };
    if (input.projectId !== undefined) {
      if (input.projectId && !this.repository.getProject(input.projectId)) throw new NotFoundError("Проект", input.projectId);
      changes.projectId = input.projectId || null;
    }
    if (input.parentTaskId !== undefined) {
      if (input.parentTaskId === id) throw new ValidationError("Задача не может быть своей подзадачей");
      if (input.parentTaskId && !this.repository.getTask(input.parentTaskId)) throw new NotFoundError("Родительская задача", input.parentTaskId);
      changes.parentTaskId = input.parentTaskId || null;
    }
    if (input.title !== undefined) changes.title = requireText(input.title, "Название задачи", 300);
    if (input.description !== undefined) changes.description = optionalText(input.description);
    if (input.priority !== undefined) changes.priority = oneOf(input.priority, TASK_PRIORITIES, "Приоритет");
    if (input.dueAt !== undefined) changes.dueAt = optionalIsoDate(input.dueAt);
    if (input.status !== undefined) {
      changes.status = oneOf(input.status, TASK_STATUSES, "Статус");
      changes.completedAt = changes.status === "done" ? changes.updatedAt : null;
    }
    const updated = this.repository.transaction(() => {
      const result = this.repository.updateTask(id, changes);
      this.activity("task", id, "updated", changes);
      return result;
    });
    this.logger.info("task.updated", { taskId: id, changes: Object.keys(changes) });
    return updated;
  }

  listProjects(filter) { return this.repository.listProjects(filter); }
  listTasks(filter) { return this.repository.listTasks(filter); }
  listDialogues(limit) { return this.repository.listDialogues(limit); }
  listActivity(limit) { return this.repository.listActivity(limit); }
  search(query) {
    const safeQuery = requireText(query, "Поисковый запрос", 200);
    return this.repository.search(safeQuery);
  }
  dashboard() { return this.repository.getDashboard(dayBounds(this.clock)); }

  bootstrap() {
    return {
      dashboard: this.dashboard(),
      projects: this.listProjects(),
      tasks: this.listTasks({ limit: 300 }),
      dialogues: this.listDialogues(80),
      activity: this.listActivity(40)
    };
  }

  processDialogue(rawInput, context = {}) {
    const input = requireText(rawInput, "Сообщение", 4000);
    const analysis = this.analyzer.analyze(input);
    let response;
    let data = null;

    switch (analysis.intent) {
      case "create_project": {
        data = this.createProject(analysis.parameters);
        response = `Создан проект «${data.title}».`;
        break;
      }
      case "create_task": {
        data = this.createTask({ ...analysis.parameters, projectId: context.projectId || null });
        const deadline = data.dueAt
          ? ` Срок — ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.dueAt))}.`
          : "";
        response = `Задача «${data.title}» добавлена.${deadline}`;
        break;
      }
      case "complete_task": {
        const task = this.repository.findTaskByTitle(analysis.parameters.title);
        if (!task) throw new NotFoundError("Незавершённая задача", analysis.parameters.title);
        data = this.updateTask(task.id, { status: "done" });
        response = `Задача «${data.title}» отмечена выполненной.`;
        break;
      }
      case "daily_plan": {
        data = this.dashboard().today;
        response = data.length
          ? `На сегодня и с просроченным сроком: ${data.length} ${this.taskWord(data.length)}.`
          : "На сегодня задач со сроком нет.";
        break;
      }
      case "search": {
        data = this.search(analysis.parameters.query);
        response = data.length
          ? `Найдено совпадений: ${data.length}.`
          : `По запросу «${analysis.parameters.query}» ничего не найдено.`;
        break;
      }
      default:
        response = "Я сохранил сообщение в истории. Сейчас я понимаю команды создания проектов и задач, завершения задач, поиска и плана на сегодня.";
    }

    const timestamp = nowIso(this.clock);
    const result = { analysis, data };
    this.repository.transaction(() => {
      this.repository.addDialogue({
        id: this.repository.newId(), role: "user", content: input, resultJson: null,
        author: this.author, createdAt: timestamp
      });
      this.repository.addDialogue({
        id: this.repository.newId(), role: "assistant", content: response,
        resultJson: JSON.stringify(result), author: "Система", createdAt: nowIso(this.clock)
      });
      this.activity("dialogue", null, "processed", { intent: analysis.intent, confidence: analysis.confidence });
    });
    return { response, ...result };
  }

  activity(entityType, entityId, action, details) {
    this.repository.addActivity({
      entityType, entityId, action, details, author: this.author, createdAt: nowIso(this.clock)
    });
  }

  taskWord(count) {
    const mod100 = count % 100;
    const mod10 = count % 10;
    if (mod100 >= 11 && mod100 <= 14) return "задач";
    if (mod10 === 1) return "задача";
    if (mod10 >= 2 && mod10 <= 4) return "задачи";
    return "задач";
  }
}
