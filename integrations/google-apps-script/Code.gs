const ORBITA = Object.freeze({
  protocolVersion: 1,
  projectSheet: "Projects",
  taskSheet: "Tasks",
  ideaSheet: "Ideas",
  instructionSheet: "Instructions",
  projectHeaders: ["id", "title", "description", "status", "color", "author", "createdAt", "updatedAt", "source", "syncHash"],
  taskHeaders: ["id", "projectId", "projectTitle", "parentTaskId", "title", "description", "status", "priority", "urgency", "dueAt", "completedAt", "author", "createdAt", "updatedAt", "source", "syncHash"],
  ideaHeaders: ["id", "title", "description", "status", "projectId", "projectTitle", "author", "createdAt", "updatedAt", "source", "syncHash"]
});

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Orbita")
    .addItem("Initial setup", "setupOrbita")
    .addItem("Show connection data", "showOrbitaConnection")
    .addToUi();
}

function setupOrbita() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty("ORBITA_SYNC_SECRET");
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, "");
    properties.setProperty("ORBITA_SYNC_SECRET", secret);
  }
  properties.setProperty("ORBITA_SPREADSHEET_ID", spreadsheet.getId());
  ensureDataSheet(spreadsheet, ORBITA.projectSheet, ORBITA.projectHeaders, {
    status: ["active", "paused", "completed", "archived"]
  });
  ensureDataSheet(spreadsheet, ORBITA.taskSheet, ORBITA.taskHeaders, {
    status: ["todo", "in_progress", "done", "cancelled"],
    priority: ["low", "normal", "high", "urgent"],
    urgency: ["urgent", "medium", "not_urgent"]
  });
  ensureDataSheet(spreadsheet, ORBITA.ideaSheet, ORBITA.ideaHeaders, {
    status: ["new", "planned", "converted", "archived"]
  });
  ensureInstructions(spreadsheet);
  normalizeWorkbook(spreadsheet);
  const result = { spreadsheetId: spreadsheet.getId(), secret: secret };
  try {
    SpreadsheetApp.getUi().alert(
      "Orbita is ready",
      "Spreadsheet ID:\n" + result.spreadsheetId + "\n\nSync secret:\n" + result.secret +
      "\n\nKeep the secret private. Next deploy this script as a Web app.",
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (ignored) {}
  console.log(JSON.stringify(result));
  return result;
}

function showOrbitaConnection() {
  const result = setupOrbita();
  return result;
}

function doGet() {
  return jsonOutput({ ok: true, service: "orbita-google-sheets", protocolVersion: ORBITA.protocolVersion });
}

function doPost(event) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const payload = JSON.parse(event && event.postData ? event.postData.contents || "{}" : "{}");
    const expected = PropertiesService.getScriptProperties().getProperty("ORBITA_SYNC_SECRET") || "";
    if (!expected || String(payload.secret || "") !== expected) {
      return jsonOutput({ ok: false, error: { code: "UNAUTHORIZED", message: "Invalid sync secret" } });
    }
    if (payload.action !== "sync") {
      return jsonOutput({ ok: false, error: { code: "INVALID_ACTION", message: "Supported action: sync" } });
    }
    const spreadsheet = orbitaSpreadsheet();
    ensureDataSheet(spreadsheet, ORBITA.projectSheet, ORBITA.projectHeaders, {
      status: ["active", "paused", "completed", "archived"]
    });
    ensureDataSheet(spreadsheet, ORBITA.taskSheet, ORBITA.taskHeaders, {
      status: ["todo", "in_progress", "done", "cancelled"],
      priority: ["low", "normal", "high", "urgent"],
      urgency: ["urgent", "medium", "not_urgent"]
    });
    ensureDataSheet(spreadsheet, ORBITA.ideaSheet, ORBITA.ideaHeaders, {
      status: ["new", "planned", "converted", "archived"]
    });
    const normalized = normalizeWorkbook(spreadsheet);
    const projects = mergeByTimestamp(normalized.projects, Array.isArray(payload.projects) ? payload.projects : [], "project");
    const tasks = mergeByTimestamp(normalized.tasks, Array.isArray(payload.tasks) ? payload.tasks : [], "task");
    const ideas = mergeByTimestamp(normalized.ideas, Array.isArray(payload.ideas) ? payload.ideas : [], "idea");
    const finalized = finalizeWorkbook(projects, tasks, ideas);
    writeEntities(spreadsheet.getSheetByName(ORBITA.projectSheet), ORBITA.projectHeaders, finalized.projects);
    writeEntities(spreadsheet.getSheetByName(ORBITA.taskSheet), ORBITA.taskHeaders, finalized.tasks);
    writeEntities(spreadsheet.getSheetByName(ORBITA.ideaSheet), ORBITA.ideaHeaders, finalized.ideas);
    return jsonOutput({
      ok: true,
      protocolVersion: ORBITA.protocolVersion,
      serverTime: new Date().toISOString(),
      projects: finalized.projects.map(stripInternal),
      tasks: finalized.tasks.map(stripInternal),
      ideas: finalized.ideas.map(stripInternal),
      stats: { projects: finalized.projects.length, tasks: finalized.tasks.length, ideas: finalized.ideas.length }
    });
  } catch (error) {
    return jsonOutput({ ok: false, error: { code: "SYNC_ERROR", message: String(error.message || error) } });
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

function normalizeWorkbook(spreadsheet) {
  let projects = readEntities(spreadsheet.getSheetByName(ORBITA.projectSheet), ORBITA.projectHeaders)
    .filter(function (item) { return text(item.title); })
    .map(function (item) { return normalizeProject(item, false); });
  let tasks = readEntities(spreadsheet.getSheetByName(ORBITA.taskSheet), ORBITA.taskHeaders)
    .filter(function (item) { return text(item.title); })
    .map(function (item) { return normalizeTask(item, false); });
  let ideas = readEntities(spreadsheet.getSheetByName(ORBITA.ideaSheet), ORBITA.ideaHeaders)
    .filter(function (item) { return text(item.title); })
    .map(function (item) { return normalizeIdea(item, false); });
  const finalized = finalizeWorkbook(projects, tasks, ideas);
  writeEntities(spreadsheet.getSheetByName(ORBITA.projectSheet), ORBITA.projectHeaders, finalized.projects);
  writeEntities(spreadsheet.getSheetByName(ORBITA.taskSheet), ORBITA.taskHeaders, finalized.tasks);
  writeEntities(spreadsheet.getSheetByName(ORBITA.ideaSheet), ORBITA.ideaHeaders, finalized.ideas);
  return finalized;
}

function orbitaSpreadsheet() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("ORBITA_SPREADSHEET_ID");
  if (!spreadsheetId) throw new Error("Run setupOrbita before publishing the Web app");
  return SpreadsheetApp.openById(spreadsheetId);
}

function finalizeWorkbook(projects, tasks, ideas) {
  const now = new Date().toISOString();
  const byTitle = {};
  const byId = {};
  projects.forEach(function (project) {
    byTitle[text(project.title).toLowerCase()] = project;
    byId[project.id] = project;
  });
  tasks.forEach(function (task) {
    const requestedTitle = text(task.projectTitle);
    if (!task.projectId && requestedTitle) {
      let project = byTitle[requestedTitle.toLowerCase()];
      if (!project) {
        project = normalizeProject({
          id: Utilities.getUuid(), title: requestedTitle, status: "active", color: "#6C5CE7",
          author: "ChatGPT", createdAt: now, updatedAt: now, source: "Google Sheets"
        }, true);
        projects.push(project);
        byTitle[requestedTitle.toLowerCase()] = project;
        byId[project.id] = project;
      }
      task.projectId = project.id;
    }
    if (task.projectId && byId[task.projectId]) task.projectTitle = byId[task.projectId].title;
    else if (task.projectId) task.projectTitle = requestedTitle;
    task.syncHash = entityHash(task, "task");
  });
  projects.forEach(function (project) { project.syncHash = entityHash(project, "project"); });
  (ideas || []).forEach(function (idea) {
    if (idea.projectId && byId[idea.projectId]) idea.projectTitle = byId[idea.projectId].title;
    else if (idea.projectId) idea.projectId = null;
    idea.syncHash = entityHash(idea, "idea");
  });
  return { projects: projects, tasks: tasks, ideas: ideas || [] };
}

function mergeByTimestamp(current, incoming, kind) {
  const values = {};
  current.forEach(function (item) { values[item.id] = item; });
  incoming.forEach(function (raw) {
    const item = kind === "project" ? normalizeProject(raw, true) : kind === "idea" ? normalizeIdea(raw, true) : normalizeTask(raw, true);
    if (!item.id || !item.title) return;
    const existing = values[item.id];
    if (!existing || item.updatedAt > existing.updatedAt) values[item.id] = item;
  });
  return Object.keys(values).map(function (id) { return values[id]; });
}

function normalizeProject(raw, trustedTimestamp) {
  const now = new Date().toISOString();
  const item = {
    id: text(raw.id) || Utilities.getUuid(),
    title: text(raw.title),
    description: nullableText(raw.description),
    status: allowed(raw.status, ["active", "paused", "completed", "archived"], "active"),
    color: /^#[0-9a-f]{6}$/i.test(text(raw.color)) ? text(raw.color) : "#6C5CE7",
    author: text(raw.author) || "ChatGPT",
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
    source: text(raw.source) || "Google Sheets",
    syncHash: text(raw.syncHash)
  };
  const hash = entityHash(item, "project");
  if (!trustedTimestamp && item.syncHash && item.syncHash !== hash) {
    item.updatedAt = now;
    item.source = "Google Sheets";
  }
  item.syncHash = entityHash(item, "project");
  return item;
}

function normalizeTask(raw, trustedTimestamp) {
  const now = new Date().toISOString();
  const item = {
    id: text(raw.id) || Utilities.getUuid(),
    projectId: nullableText(raw.projectId),
    projectTitle: nullableText(raw.projectTitle),
    parentTaskId: nullableText(raw.parentTaskId),
    title: text(raw.title),
    description: nullableText(raw.description),
    status: allowed(raw.status, ["todo", "in_progress", "done", "cancelled"], "todo"),
    priority: allowed(raw.priority, ["low", "normal", "high", "urgent"], "normal"),
    urgency: allowed(raw.urgency, ["urgent", "medium", "not_urgent"], urgencyFromDate(raw.dueAt)),
    dueAt: nullableIso(raw.dueAt),
    completedAt: nullableIso(raw.completedAt),
    author: text(raw.author) || "ChatGPT",
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
    source: text(raw.source) || "Google Sheets",
    syncHash: text(raw.syncHash)
  };
  if (item.status === "done" && !item.completedAt) item.completedAt = item.updatedAt;
  if (item.status !== "done") item.completedAt = null;
  const hash = entityHash(item, "task");
  if (!trustedTimestamp && item.syncHash && item.syncHash !== hash) {
    item.updatedAt = now;
    item.source = "Google Sheets";
    if (item.status === "done" && !item.completedAt) item.completedAt = now;
  }
  item.syncHash = entityHash(item, "task");
  return item;
}

function normalizeIdea(raw, trustedTimestamp) {
  const now = new Date().toISOString();
  const item = {
    id: text(raw.id) || Utilities.getUuid(),
    title: text(raw.title),
    description: nullableText(raw.description),
    status: allowed(raw.status, ["new", "planned", "converted", "archived"], "new"),
    projectId: nullableText(raw.projectId),
    projectTitle: nullableText(raw.projectTitle),
    author: text(raw.author) || "ChatGPT",
    createdAt: iso(raw.createdAt, now),
    updatedAt: iso(raw.updatedAt, now),
    source: text(raw.source) || "Google Sheets",
    syncHash: text(raw.syncHash)
  };
  const hash = entityHash(item, "idea");
  if (!trustedTimestamp && item.syncHash && item.syncHash !== hash) {
    item.updatedAt = now;
    item.source = "Google Sheets";
  }
  item.syncHash = entityHash(item, "idea");
  return item;
}

function readEntities(sheet, headers) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return rows.map(function (row) {
    const item = {};
    headers.forEach(function (header, index) { item[header] = row[index]; });
    return item;
  });
}

function writeEntities(sheet, headers, entities) {
  const existingRows = Math.max(sheet.getLastRow() - 1, 0);
  if (existingRows) sheet.getRange(2, 1, existingRows, headers.length).clearContent();
  if (!entities.length) return;
  const rows = entities
    .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); })
    .map(function (item) { return headers.map(function (header) { return item[header] == null ? "" : item[header]; }); });
  sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

function ensureDataSheet(spreadsheet, name, headers, validations) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const currentHeaders = sheet.getLastColumn()
    ? sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length)).getValues()[0]
    : [];
  if (name === ORBITA.taskSheet && currentHeaders.indexOf("dueAt") >= 0 && currentHeaders.indexOf("urgency") < 0) {
    sheet.insertColumnBefore(currentHeaders.indexOf("dueAt") + 1);
  }
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length)
    .setBackground("#5143BE").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.setRowHeight(1, 30);
  sheet.setColumnWidth(1, 240);
  headers.forEach(function (header, index) {
    const width = ["title", "description", "projectTitle"].indexOf(header) >= 0 ? 220 :
      ["createdAt", "updatedAt", "completedAt", "dueAt"].indexOf(header) >= 0 ? 165 : 125;
    sheet.setColumnWidth(index + 1, width);
  });
  Object.keys(validations || {}).forEach(function (header) {
    const column = headers.indexOf(header) + 1;
    if (!column) return;
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(validations[header], true).setAllowInvalid(false).build();
    sheet.getRange(2, column, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
  });
  const hashColumn = headers.indexOf("syncHash") + 1;
  if (hashColumn > 0) sheet.hideColumns(hashColumn);
  if (name === ORBITA.taskSheet) {
    const urgencyColumn = headers.indexOf("urgency") + 1;
    const dataRange = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), headers.length);
    const retainedRules = sheet.getConditionalFormatRules().filter(function (rule) {
      return rule.getBooleanCondition() == null || rule.getBooleanCondition().getCriteriaValues()[0] !== "=$I2=\"urgent\"";
    });
    retainedRules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied("=$" + columnName(urgencyColumn) + "2=\"urgent\"")
      .setBackground("#FCE8EC").setFontColor("#9B1C31").setRanges([dataRange]).build());
    sheet.setConditionalFormatRules(retainedRules);
  }
  return sheet;
}

function ensureInstructions(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(ORBITA.instructionSheet);
  if (!sheet) sheet = spreadsheet.insertSheet(ORBITA.instructionSheet, 0);
  const rows = [
    ["ОРБИТА — единый реестр задач"],
    ["Листы: Tasks — задачи и подзадачи, Projects — проекты, Ideas — идеи на будущее."],
    ["Классификация: действие — Tasks; результат из нескольких шагов — Projects и связанные Tasks; мысль без обязательства — Ideas."],
    ["Срочность Tasks: urgent — сегодня, medium — завтра, not_urgent — конкретная более поздняя дата. Срочные строки выделяются красным."],
    ["Не изменяйте id, createdAt и syncHash. При ручном добавлении заполните title, projectTitle, status, priority, urgency и dueAt."],
    ["Статусы задач: todo, in_progress, done, cancelled. Статусы идей: new, planned, converted, archived."],
    ["Для синхронизации запустите setupOrbita(), затем опубликуйте Apps Script как Web app: Execute as Me, access Anyone."],
    ["Секрет храните только в настройках Орбиты и не публикуйте."]
  ];
  sheet.clear();
  sheet.getRange(1, 1, rows.length, 1).setValues(rows);
  sheet.getRange("A1").setFontSize(18).setFontWeight("bold").setFontColor("#5143BE");
  sheet.getRange(2, 1, rows.length - 1, 1).setWrap(true).setVerticalAlignment("top");
  sheet.setColumnWidth(1, 760);
  sheet.setRowHeight(1, 36);
  for (let row = 2; row <= rows.length; row++) sheet.setRowHeight(row, 46);
  sheet.setFrozenRows(1);
}

function entityHash(item, kind) {
  const fields = kind === "project"
    ? ["id", "title", "description", "status", "color", "author", "createdAt", "updatedAt", "source"]
    : kind === "idea"
      ? ["id", "title", "description", "status", "projectId", "projectTitle", "author", "createdAt", "updatedAt", "source"]
      : ["id", "projectId", "projectTitle", "parentTaskId", "title", "description", "status", "priority", "urgency", "dueAt", "completedAt", "author", "createdAt", "updatedAt", "source"];
  const value = fields.map(function (field) { return item[field] == null ? "" : String(item[field]); }).join("\u001f");
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)).replace(/=+$/g, "");
}

function stripInternal(item) {
  const copy = {};
  Object.keys(item).forEach(function (key) {
    if (key !== "syncHash" && key !== "projectTitle") copy[key] = item[key] === "" ? null : item[key];
  });
  return copy;
}

function allowed(value, values, fallback) {
  const normalized = text(value);
  return values.indexOf(normalized) >= 0 ? normalized : fallback;
}

function text(value) { return value == null ? "" : String(value).trim(); }
function nullableText(value) { const valueText = text(value); return valueText || null; }
function iso(value, fallback) {
  if (value instanceof Date && !isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(text(value));
  return isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}
function nullableIso(value) { return text(value) ? iso(value, null) : null; }
function urgencyFromDate(value) {
  const due = new Date(text(value));
  if (isNaN(due.getTime())) return "not_urgent";
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const difference = Math.round((dueDay.getTime() - today.getTime()) / 86400000);
  return difference <= 0 ? "urgent" : difference === 1 ? "medium" : "not_urgent";
}
function columnName(column) {
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
