import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "../domain/errors.js";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const EPOCH = "1970-01-01T00:00:00.000Z";
const PROJECT_HEADERS = ["id", "title", "description", "status", "color", "author", "createdAt", "updatedAt", "source", "syncHash"];
const TASK_HEADERS = ["id", "projectId", "projectTitle", "parentTaskId", "title", "description", "status", "priority", "dueAt", "completedAt", "author", "createdAt", "updatedAt", "source", "syncHash"];
const PROJECT_STATUSES = ["active", "paused", "completed", "archived"];
const TASK_STATUSES = ["todo", "in_progress", "done", "cancelled"];
const PRIORITIES = ["low", "normal", "high", "urgent"];

export class GoogleSheetsApiService {
  constructor({ config, oauth, syncService, fetchImpl = fetch, clock = () => new Date(), logger }) {
    this.config = config.googleOAuth;
    this.oauth = oauth;
    this.syncService = syncService;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.logger = logger;
  }

  status() {
    let spreadsheet = null;
    let error = null;
    try { spreadsheet = this.loadSpreadsheet(); } catch (loadError) { error = loadError.message; }
    const oauth = this.oauth.status();
    return { ...oauth, spreadsheet, ready: Boolean(oauth.connected && spreadsheet?.spreadsheetId), error: error || oauth.error };
  }

  ready() { return this.status().ready; }

  async createSpreadsheet(title = "Орбита — задачи") {
    const result = await this.request("", {
      method: "POST",
      body: {
        properties: { title: String(title || "Орбита — задачи").trim().slice(0, 120) },
        sheets: [
          { properties: { title: "Instructions", index: 0 } },
          { properties: { title: "Projects", index: 1 } },
          { properties: { title: "Tasks", index: 2 } }
        ]
      }
    });
    const spreadsheet = {
      spreadsheetId: result.spreadsheetId,
      title: result.properties?.title || title,
      url: result.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${result.spreadsheetId}/edit`
    };
    await this.initializeSpreadsheet(spreadsheet.spreadsheetId);
    this.saveSpreadsheet(spreadsheet);
    this.logger.info("google-sheets.created", { spreadsheetId: spreadsheet.spreadsheetId });
    return spreadsheet;
  }

  async connectSpreadsheet(value) {
    const spreadsheetId = this.spreadsheetId(value);
    const result = await this.request(`/${encodeURIComponent(spreadsheetId)}?fields=spreadsheetId,spreadsheetUrl,properties.title,sheets.properties`, { method: "GET" });
    await this.initializeSpreadsheet(spreadsheetId, result.sheets || []);
    const spreadsheet = {
      spreadsheetId,
      title: result.properties?.title || "Орбита — задачи",
      url: result.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    };
    this.saveSpreadsheet(spreadsheet);
    return spreadsheet;
  }

  disconnectSpreadsheet() {
    if (fs.existsSync(this.config.spreadsheetFile)) fs.unlinkSync(this.config.spreadsheetFile);
  }

  async synchronize(reason = "manual") {
    const spreadsheet = this.loadSpreadsheet();
    if (!spreadsheet?.spreadsheetId) throw new DomainError("Сначала создайте или подключите Google Таблицу", "GOOGLE_SPREADSHEET_REQUIRED", 409);
    const spreadsheetId = spreadsheet.spreadsheetId;
    const params = new URLSearchParams();
    params.append("ranges", "Projects!A2:J");
    params.append("ranges", "Tasks!A2:O");
    params.set("majorDimension", "ROWS");
    const response = await this.request(`/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`, { method: "GET" });
    const projectRows = response.valueRanges?.[0]?.values || [];
    const taskRows = response.valueRanges?.[1]?.values || [];
    const normalized = this.normalizeRemote(projectRows, taskRows);
    this.syncService.push({ deviceId: "google-oauth-sheets", projects: normalized.projects, tasks: normalized.tasks });
    const snapshot = this.syncService.pull(EPOCH);
    const projectTitles = new Map(snapshot.projects.map(project => [project.id, project.title]));
    const projects = snapshot.projects.map(project => this.projectRow(project));
    const tasks = snapshot.tasks.map(task => this.taskRow(task, projectTitles));

    await this.request(`/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
      method: "POST", body: { ranges: ["Projects!A2:J", "Tasks!A2:O"] }
    });
    await this.request(`/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: "POST",
      body: {
        valueInputOption: "RAW",
        data: [
          { range: "Projects!A2:J", majorDimension: "ROWS", values: projects },
          { range: "Tasks!A2:O", majorDimension: "ROWS", values: tasks }
        ]
      }
    });
    const result = {
      mode: "oauth",
      serverTime: this.clock().toISOString(),
      projects: projects.length,
      tasks: tasks.length,
      spreadsheet
    };
    this.logger.info("google-sheets.oauth-synchronized", { reason, projects: result.projects, tasks: result.tasks });
    return result;
  }

  normalizeRemote(projectRows, taskRows) {
    const projects = projectRows.map(row => this.normalizeProject(this.rowObject(PROJECT_HEADERS, row))).filter(item => item.title);
    const byId = new Map(projects.map(item => [item.id, item]));
    const byTitle = new Map(projects.map(item => [item.title.toLocaleLowerCase("ru-RU"), item]));
    const tasks = taskRows.map(row => this.normalizeTask(this.rowObject(TASK_HEADERS, row))).filter(item => item.title);

    for (const task of tasks) {
      const projectTitle = String(task.projectTitle || "").trim();
      if (!task.projectId && projectTitle) {
        let project = byTitle.get(projectTitle.toLocaleLowerCase("ru-RU"));
        if (!project) {
          project = this.normalizeProject({ title: projectTitle, author: "ChatGPT", source: "Google Sheets" });
          projects.push(project);
          byId.set(project.id, project);
          byTitle.set(project.title.toLocaleLowerCase("ru-RU"), project);
        }
        task.projectId = project.id;
      }
      if (task.projectId && !byId.has(task.projectId)) task.projectId = null;
      delete task.projectTitle;
    }
    const taskIds = new Set(tasks.map(task => task.id));
    for (const task of tasks) if (task.parentTaskId && !taskIds.has(task.parentTaskId)) task.parentTaskId = null;
    tasks.sort((left, right) => Number(Boolean(left.parentTaskId)) - Number(Boolean(right.parentTaskId)));
    return { projects, tasks };
  }

  normalizeProject(raw) {
    const now = this.clock().toISOString();
    const project = {
      id: this.uuid(raw.id),
      title: this.text(raw.title),
      description: this.nullable(raw.description),
      status: PROJECT_STATUSES.includes(raw.status) ? raw.status : "active",
      color: /^#[0-9a-f]{6}$/iu.test(raw.color || "") ? raw.color : "#6C5CE7",
      author: this.text(raw.author) || "ChatGPT",
      createdAt: this.iso(raw.createdAt, now),
      updatedAt: this.iso(raw.updatedAt, now),
      source: this.text(raw.source) || "Google Sheets",
      syncHash: this.text(raw.syncHash)
    };
    const hash = this.hash(project, "project");
    if (project.syncHash && project.syncHash !== hash) {
      project.updatedAt = now;
      project.source = "Google Sheets";
    }
    delete project.syncHash;
    delete project.source;
    return project;
  }

  normalizeTask(raw) {
    const now = this.clock().toISOString();
    const task = {
      id: this.uuid(raw.id),
      projectId: this.nullable(raw.projectId),
      projectTitle: this.nullable(raw.projectTitle),
      parentTaskId: this.nullable(raw.parentTaskId),
      title: this.text(raw.title),
      description: this.nullable(raw.description),
      status: TASK_STATUSES.includes(raw.status) ? raw.status : "todo",
      priority: PRIORITIES.includes(raw.priority) ? raw.priority : "normal",
      dueAt: this.nullableIso(raw.dueAt),
      completedAt: this.nullableIso(raw.completedAt),
      author: this.text(raw.author) || "ChatGPT",
      createdAt: this.iso(raw.createdAt, now),
      updatedAt: this.iso(raw.updatedAt, now),
      source: this.text(raw.source) || "Google Sheets",
      syncHash: this.text(raw.syncHash)
    };
    const hash = this.hash(task, "task");
    if (task.syncHash && task.syncHash !== hash) {
      task.updatedAt = now;
      task.source = "Google Sheets";
    }
    if (task.status === "done" && !task.completedAt) task.completedAt = task.updatedAt;
    if (task.status !== "done") task.completedAt = null;
    delete task.syncHash;
    delete task.source;
    return task;
  }

  projectRow(project) {
    const value = {
      ...project,
      source: project.author || "Orbita"
    };
    value.syncHash = this.hash(value, "project");
    return PROJECT_HEADERS.map(header => value[header] ?? "");
  }

  taskRow(task, projectTitles) {
    const value = {
      ...task,
      projectTitle: task.projectId ? projectTitles.get(task.projectId) || "" : "",
      source: task.author || "Orbita"
    };
    value.syncHash = this.hash(value, "task");
    return TASK_HEADERS.map(header => value[header] ?? "");
  }

  hash(item, kind) {
    const fields = kind === "project" ? PROJECT_HEADERS.slice(0, -1) : TASK_HEADERS.slice(0, -1);
    const serialized = fields.map(field => item[field] == null ? "" : String(item[field])).join("\u001f");
    return createHash("sha256").update(serialized).digest("base64url");
  }

  async initializeSpreadsheet(spreadsheetId, knownSheets = null) {
    let sheets = knownSheets;
    if (!sheets) {
      const current = await this.request(`/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`, { method: "GET" });
      sheets = current.sheets || [];
    }
    const names = new Set(sheets.map(sheet => sheet.properties?.title));
    const requests = ["Instructions", "Projects", "Tasks"]
      .filter(title => !names.has(title))
      .map(title => ({ addSheet: { properties: { title } } }));
    if (requests.length) await this.request(`/${encodeURIComponent(spreadsheetId)}:batchUpdate`, { method: "POST", body: { requests } });
    await this.request(`/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: "POST",
      body: {
        valueInputOption: "RAW",
        data: [
          { range: "Instructions!A1:A6", values: [
            ["ОРБИТА — единый реестр задач"],
            ["Projects хранит проекты, Tasks — задачи."],
            ["Изменения Windows, Android и ChatGPT объединяются по updatedAt."],
            ["Не удаляйте строки: используйте cancelled и archived."],
            ["Технические поля id, createdAt и syncHash изменять не следует."],
            ["Не храните в задачах пароли, ключи и другие секреты."]
          ] },
          { range: "Projects!A1:J1", values: [PROJECT_HEADERS] },
          { range: "Tasks!A1:O1", values: [TASK_HEADERS] }
        ]
      }
    });
  }

  async request(suffix, { method, body } = {}) {
    const accessToken = await this.oauth.accessToken();
    const response = await this.fetchImpl(`${API}${suffix}`, {
      method: method || "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {})
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000)
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = value.error?.message || `Google Sheets API: HTTP ${response.status}`;
      throw new DomainError(message, "GOOGLE_SHEETS_API_FAILED", response.status === 403 ? 403 : 502);
    }
    return value;
  }

  rowObject(headers, row) {
    return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
  }

  spreadsheetId(value) {
    const text = String(value || "").trim();
    const fromUrl = text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/u)?.[1];
    const id = fromUrl || text;
    if (!/^[A-Za-z0-9_-]{20,}$/u.test(id)) throw new DomainError("Некорректный адрес или ID Google Таблицы", "GOOGLE_SPREADSHEET_INVALID_ID", 400);
    return id;
  }

  loadSpreadsheet() {
    if (!fs.existsSync(this.config.spreadsheetFile)) return null;
    try { return JSON.parse(fs.readFileSync(this.config.spreadsheetFile, "utf8").replace(/^\uFEFF/u, "")); }
    catch { throw new Error("Некорректный файл настройки Google Таблицы"); }
  }

  saveSpreadsheet(value) {
    fs.mkdirSync(path.dirname(this.config.spreadsheetFile), { recursive: true });
    fs.writeFileSync(this.config.spreadsheetFile, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  uuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value || "") ? String(value).toLowerCase() : randomUUID(); }
  text(value) { return value == null ? "" : String(value).trim(); }
  nullable(value) { const text = this.text(value); return text || null; }
  iso(value, fallback) { const date = new Date(value || ""); return Number.isNaN(date.valueOf()) ? fallback : date.toISOString(); }
  nullableIso(value) { return this.text(value) ? this.iso(value, null) : null; }
}
