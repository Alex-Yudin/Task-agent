const state = {
  data: { dashboard: { stats: {}, today: [] }, projects: [], tasks: [], dialogues: [], activity: [] },
  view: "dashboard",
  taskFilter: "open",
  projectFilter: "all",
  selectedProjectId: null,
  busy: false
};

const elements = {
  content: document.querySelector("#content"),
  viewTitle: document.querySelector("#viewTitle"),
  dateLabel: document.querySelector("#dateLabel"),
  chatMessages: document.querySelector("#chatMessages"),
  chatForm: document.querySelector("#chatForm"),
  chatInput: document.querySelector("#chatInput"),
  voiceButton: document.querySelector("#voiceButton"),
  voiceStatus: document.querySelector("#voiceStatus"),
  searchInput: document.querySelector("#searchInput"),
  taskDialog: document.querySelector("#taskDialog"),
  taskForm: document.querySelector("#taskForm"),
  projectDialog: document.querySelector("#projectDialog"),
  projectForm: document.querySelector("#projectForm"),
  googleSheetsState: document.querySelector("#googleSheetsState"),
  googleDialog: document.querySelector("#googleDialog"),
  googleAccountStatus: document.querySelector("#googleAccountStatus"),
  googleSpreadsheetStatus: document.querySelector("#googleSpreadsheetStatus"),
  googleCredentialsHint: document.querySelector("#googleCredentialsHint"),
  toastRegion: document.querySelector("#toastRegion")
};

const labels = {
  status: { todo: "К выполнению", in_progress: "В работе", done: "Выполнена", cancelled: "Отменена" },
  priority: { low: "Низкий", normal: "Обычный", high: "Высокий", urgent: "Срочный" },
  type: { project: "Проект", task: "Задача", dialogue: "Диалог", context: "Контекст", document: "Документ", contact: "Контакт", event: "Событие", decision: "Решение", reminder: "Напоминание", source: "Источник" },
  action: { created: "Создано", updated: "Изменено", processed: "Обработан диалог" }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value, { time = false } = {}) {
  if (!value) return "Без срока";
  const date = new Date(value);
  return new Intl.DateTimeFormat("ru-RU", time
    ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short" }).format(date);
}

function isOverdue(task) {
  return task.dueAt && new Date(task.dueAt) < new Date() && !["done", "cancelled"].includes(task.status);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error?.message || "Не удалось выполнить запрос");
  return body;
}

function toast(message, type = "success") {
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.textContent = message;
  elements.toastRegion.append(node);
  setTimeout(() => node.remove(), 3600);
}

async function refresh() {
  state.data = await api("/api/bootstrap");
  refreshGoogleSheetsStatus();
  populateProjectSelect();
  renderChat();
  render();
}

async function refreshGoogleSheetsStatus() {
  try {
    const status = await api("/api/google-sheets/status");
    let label = "Google Таблица не настроена";
    if (status.configured && status.inProgress) label = "Google: синхронизация…";
    else if (status.configured && status.lastError) label = "Google: требуется внимание";
    else if (status.configured && status.lastSuccessAt) label = `Google: ${formatDate(status.lastSuccessAt, { time: true })}`;
    else if (status.configured) label = "Google Таблица подключена";
    elements.googleSheetsState.querySelector("span").textContent = label;
  } catch {
    elements.googleSheetsState.querySelector("span").textContent = "Google: статус недоступен";
  }
}

async function refreshGoogleOAuthStatus() {
  const status = await api("/api/google/oauth/status");
  elements.googleAccountStatus.querySelector("span").textContent = status.scopeError
    || (status.connected ? `Подключён: ${status.account?.email || "Google-аккаунт"}` : "Google-аккаунт не подключён");
  elements.googleSpreadsheetStatus.querySelector("span").textContent = status.spreadsheet
    ? `Таблица: ${status.spreadsheet.title}`
    : "Таблица не выбрана";
  elements.googleCredentialsHint.hidden = status.clientSecretConfigured;
  document.querySelector("#googleSignInButton").hidden = status.connected || !status.clientSecretConfigured;
  document.querySelector("#googleCreateSheetButton").hidden = !status.connected || Boolean(status.spreadsheet);
  document.querySelector("#googleUseSheetButton").hidden = !status.connected;
  document.querySelector("#googleSpreadsheetInput").parentElement.hidden = !status.connected;
  const openLink = document.querySelector("#googleOpenSheetLink");
  openLink.hidden = !status.spreadsheet?.url;
  openLink.href = status.spreadsheet?.url || "#";
  document.querySelector("#googleDisconnectButton").hidden = !status.authorized;
  return status;
}

async function waitForGoogleLogin() {
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    try {
      const status = await refreshGoogleOAuthStatus();
      if (status.connected) {
        toast("Google-аккаунт подключён");
        await refreshGoogleSheetsStatus();
        return;
      }
    } catch {}
  }
}

function setHeader(title) {
  elements.viewTitle.textContent = title;
  const now = new Date();
  elements.dateLabel.textContent = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long" }).format(now);
}

function taskItem(task, compact = false) {
  return `
    <div class="task-item" data-task-id="${task.id}">
      <button class="task-check" data-action="toggle-task" aria-label="Отметить задачу выполненной"></button>
      <div>
        <div class="task-title ${task.status === "done" ? "done" : ""}">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="priority ${task.priority}"></span>
          <span>${escapeHtml(task.projectTitle || "Без проекта")}</span>
          <span class="task-due ${isOverdue(task) ? "overdue" : ""}">${isOverdue(task) ? "Просрочено · " : ""}${formatDate(task.dueAt)}</span>
          ${task.subtaskCount ? `<span>${task.completedSubtaskCount}/${task.subtaskCount} подзадач</span>` : ""}
        </div>
      </div>
      <div class="task-actions">
        ${compact ? "" : `<button class="mini-button" data-action="add-subtask" title="Добавить подзадачу">＋ подзадача</button>`}
        <span class="status-pill ${task.status}">${labels.status[task.status]}</span>
      </div>
    </div>`;
}

function emptyState(title, message) {
  return `<div class="empty-state"><div><span>◇</span><strong>${escapeHtml(title)}</strong><div>${escapeHtml(message)}</div></div></div>`;
}

function renderDashboard() {
  setHeader(greeting());
  const { stats, today } = state.data.dashboard;
  const projects = state.data.projects.filter(project => project.status === "active").slice(0, 5);
  const focusTitle = today.length
    ? `В фокусе ${today.length} ${taskWord(today.length)} — начните с самой срочной`
    : "План свободен — самое время определить следующий шаг";
  elements.content.innerHTML = `
    <article class="focus-card">
      <div><p class="eyebrow">ФОКУС ДНЯ</p><h2>${focusTitle}</h2><p>${stats.overdueTasks ? `Просрочено: ${stats.overdueTasks}. Разберите их в первую очередь.` : "Просроченных задач нет."}</p></div>
      <div class="focus-number">${today.length}</div>
    </article>
    <div class="stats-grid">
      <div class="stat-card"><em>◇</em><small>Активные проекты</small><strong>${stats.activeProjects ?? 0}</strong></div>
      <div class="stat-card"><em>✓</em><small>Открытые задачи</small><strong>${stats.openTasks ?? 0}</strong></div>
      <div class="stat-card"><em>◷</em><small>На сегодня</small><strong>${stats.todayTasks ?? 0}</strong></div>
      <div class="stat-card warning"><em>!</em><small>Просрочено</small><strong>${stats.overdueTasks ?? 0}</strong></div>
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="section-heading"><div><h2>Сегодня</h2><p>Задачи со сроком на сегодня и просроченные</p></div><button class="text-button" data-view-target="tasks">Все задачи →</button></div>
        <div class="task-list">${today.length ? today.map(task => taskItem(task, true)).join("") : emptyState("На сегодня всё свободно", "Добавьте задачу через кнопку или попросите Орбиту.")}</div>
      </section>
      <section class="panel">
        <div class="section-heading"><div><h2>Проекты</h2><p>Текущая работа</p></div><button class="text-button" data-action="new-project">＋</button></div>
        <div class="project-list">${projects.length ? projects.map(projectRow).join("") : emptyState("Проектов пока нет", "Создайте первый проект.")}</div>
      </section>
    </div>`;
}

function projectRow(project) {
  const percent = project.taskCount ? Math.round(project.completedTaskCount / project.taskCount * 100) : 0;
  return `<div class="project-row" data-action="open-project" data-project-id="${project.id}">
    <span class="project-color" style="background:${project.color}"></span>
    <span><strong>${escapeHtml(project.title)}</strong><small>${project.taskCount} ${taskWord(project.taskCount)}</small></span>
    <span class="progress-ring">${percent}%</span>
  </div>`;
}

function renderProjects() {
  setHeader("Проекты");
  const filters = [
    ["all", "Все"], ["active", "Активные"], ["paused", "На паузе"], ["completed", "Завершённые"]
  ];
  const projects = state.projectFilter === "all"
    ? state.data.projects
    : state.data.projects.filter(project => project.status === state.projectFilter);
  elements.content.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-group">${filters.map(([value, title]) => `<button class="filter-button ${state.projectFilter === value ? "active" : ""}" data-project-filter="${value}">${title}</button>`).join("")}</div>
      <button class="primary-button" data-action="new-project"><span>＋</span>Новый проект</button>
    </div>
    <div class="project-grid">
      ${projects.map(projectCard).join("")}
      <button class="add-card" data-action="new-project"><div><span>＋</span>Создать проект</div></button>
    </div>`;
}

function projectCard(project) {
  const percent = project.taskCount ? Math.round(project.completedTaskCount / project.taskCount * 100) : 0;
  return `<article class="project-card" style="--project-color:${project.color}" data-action="open-project" data-project-id="${project.id}">
    <span class="status-pill ${project.status === "completed" ? "done" : "in_progress"}">${projectStatus(project.status)}</span>
    <h3>${escapeHtml(project.title)}</h3>
    <p>${escapeHtml(project.description || "Описание проекта пока не добавлено.")}</p>
    <div class="project-card-foot"><span>${project.completedTaskCount} из ${project.taskCount} задач</span><span>${percent}%</span></div>
    <div class="progress-track"><i style="width:${percent}%"></i></div>
  </article>`;
}

function renderTasks() {
  setHeader(state.selectedProjectId ? state.data.projects.find(item => item.id === state.selectedProjectId)?.title || "Задачи" : "Задачи");
  const filters = [["open", "Открытые"], ["todo", "К выполнению"], ["in_progress", "В работе"], ["done", "Выполненные"], ["all", "Все"]];
  let tasks = state.data.tasks;
  if (state.selectedProjectId) tasks = tasks.filter(task => task.projectId === state.selectedProjectId);
  if (state.taskFilter === "open") tasks = tasks.filter(task => !["done", "cancelled"].includes(task.status));
  else if (state.taskFilter !== "all") tasks = tasks.filter(task => task.status === state.taskFilter);
  const roots = tasks.filter(task => !task.parentTaskId || !tasks.some(candidate => candidate.id === task.parentTaskId));
  const ordered = roots.flatMap(root => [root, ...tasks.filter(task => task.parentTaskId === root.id)]);
  elements.content.innerHTML = `
    <div class="page-toolbar">
      <div class="filter-group">${filters.map(([value, title]) => `<button class="filter-button ${state.taskFilter === value ? "active" : ""}" data-task-filter="${value}">${title}</button>`).join("")}</div>
      ${state.selectedProjectId ? `<button class="text-button" data-action="clear-project">Показать все проекты ×</button>` : ""}
    </div>
    <section class="panel table-panel">
      <div class="task-table-head"><span></span><span>Задача</span><span>Проект</span><span>Срок</span><span>Статус</span><span></span></div>
      ${ordered.length ? ordered.map(taskTableRow).join("") : emptyState("Задач не найдено", "Измените фильтр или добавьте новую задачу.")}
    </section>`;
}

function taskTableRow(task) {
  const isChild = Boolean(task.parentTaskId);
  return `<div class="task-table-row" data-task-id="${task.id}">
    <button class="task-check" data-action="toggle-task" aria-label="Изменить статус"></button>
    <div><div class="task-title ${task.status === "done" ? "done" : ""}" style="padding-left:${isChild ? 18 : 0}px">${isChild ? "↳ " : ""}${escapeHtml(task.title)}</div><div class="task-meta"><span class="priority ${task.priority}"></span>${labels.priority[task.priority]}${task.subtaskCount ? ` · ${task.completedSubtaskCount}/${task.subtaskCount} подзадач` : ""}</div></div>
    <span class="project-tag">${escapeHtml(task.projectTitle || "Без проекта")}</span>
    <span class="task-due ${isOverdue(task) ? "overdue" : ""}">${formatDate(task.dueAt)}</span>
    <span><span class="status-pill ${task.status}">${labels.status[task.status]}</span></span>
    <button class="mini-button" data-action="add-subtask" title="Добавить подзадачу">＋</button>
  </div>`;
}

function renderHistory() {
  setHeader("История действий");
  const activity = state.data.activity;
  elements.content.innerHTML = `
    <div class="section-heading"><div><h2>Журнал активности</h2><p>Все изменения фиксируются автоматически</p></div></div>
    <div class="timeline">${activity.length ? activity.map(activityItem).join("") : emptyState("История пока пуста", "Здесь появятся созданные проекты, задачи и команды.")}</div>`;
}

function activityItem(item) {
  const subject = item.details?.title || item.details?.intent || item.entityType;
  return `<article class="timeline-item"><span class="timeline-icon">${item.action === "created" ? "+" : item.action === "processed" ? "◷" : "↻"}</span><div><strong>${labels.action[item.action] || item.action}</strong><p>${escapeHtml(subject)}</p></div><time>${formatDate(item.createdAt, { time: true })}</time></article>`;
}

function renderSearch(results, query) {
  setHeader(`Поиск: ${query}`);
  elements.content.innerHTML = `<div class="section-heading"><div><h2>Результаты поиска</h2><p>Найдено: ${results.length}</p></div><button class="text-button" data-view-target="dashboard">Закрыть поиск ×</button></div>
    <div class="search-results">${results.length ? results.map(item => `<article class="search-result"><span class="type-pill">${labels.type[item.type] || item.type}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml((item.snippet || "").slice(0, 260))}</p></article>`).join("") : emptyState("Ничего не найдено", "Попробуйте другой запрос.")}</div>`;
}

function renderChat() {
  const messages = state.data.dialogues;
  const intro = `<div class="message assistant">Здравствуйте. Я могу создать проект или задачу, завершить задачу, найти обсуждение и собрать план на сегодня.<time>локальный режим</time></div>`;
  elements.chatMessages.innerHTML = intro + messages.map(message => `<div class="message ${message.role === "user" ? "user" : "assistant"}">${escapeHtml(message.content)}<time>${formatDate(message.createdAt, { time: true })}</time></div>`).join("");
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function render() {
  document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
  if (state.view === "projects") renderProjects();
  else if (state.view === "tasks") renderTasks();
  else if (state.view === "history") renderHistory();
  else renderDashboard();
}

function greeting() {
  const hour = new Date().getHours();
  if (hour < 6) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
}

function taskWord(count) {
  const mod100 = count % 100;
  const mod10 = count % 10;
  if (mod100 >= 11 && mod100 <= 14) return "задач";
  if (mod10 === 1) return "задача";
  if (mod10 >= 2 && mod10 <= 4) return "задачи";
  return "задач";
}

function projectStatus(status) {
  return ({ active: "Активный", paused: "На паузе", completed: "Завершён", archived: "Архив" })[status] || status;
}

function populateProjectSelect() {
  const select = elements.taskForm.elements.projectId;
  const current = select.value;
  select.innerHTML = `<option value="">Без проекта</option>${state.data.projects.filter(project => project.status === "active").map(project => `<option value="${project.id}">${escapeHtml(project.title)}</option>`).join("")}`;
  select.value = current;
}

function openTaskDialog({ projectId = state.selectedProjectId || "", parentTaskId = "" } = {}) {
  elements.taskForm.reset();
  elements.taskForm.elements.projectId.value = projectId || "";
  elements.taskForm.elements.parentTaskId.value = parentTaskId;
  elements.taskDialog.showModal();
  setTimeout(() => elements.taskForm.elements.title.focus(), 30);
}

async function submitTask(event) {
  event.preventDefault();
  const form = new FormData(elements.taskForm);
  const payload = Object.fromEntries(form.entries());
  payload.projectId ||= null;
  payload.parentTaskId ||= null;
  payload.dueAt = payload.dueAt ? new Date(payload.dueAt).toISOString() : null;
  try {
    await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
    elements.taskDialog.close();
    toast(payload.parentTaskId ? "Подзадача добавлена" : "Задача добавлена");
    await refresh();
  } catch (error) { toast(error.message, "error"); }
}

async function submitProject(event) {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(elements.projectForm).entries());
  try {
    await api("/api/projects", { method: "POST", body: JSON.stringify(payload) });
    elements.projectDialog.close();
    toast("Проект создан");
    await refresh();
  } catch (error) { toast(error.message, "error"); }
}

async function handleContentClick(event) {
  const target = event.target.closest("[data-action], [data-view-target], [data-task-filter], [data-project-filter]");
  if (!target) return;
  if (target.dataset.viewTarget) {
    state.view = target.dataset.viewTarget;
    state.selectedProjectId = null;
    render();
    return;
  }
  if (target.dataset.taskFilter) { state.taskFilter = target.dataset.taskFilter; render(); return; }
  if (target.dataset.projectFilter) { state.projectFilter = target.dataset.projectFilter; render(); return; }
  const action = target.dataset.action;
  if (action === "new-project") elements.projectDialog.showModal();
  if (action === "clear-project") { state.selectedProjectId = null; render(); }
  if (action === "open-project") {
    state.selectedProjectId = target.dataset.projectId;
    state.view = "tasks";
    render();
  }
  if (action === "add-subtask") {
    const task = state.data.tasks.find(item => item.id === target.closest("[data-task-id]").dataset.taskId);
    openTaskDialog({ projectId: task.projectId, parentTaskId: task.id });
  }
  if (action === "toggle-task") {
    const task = state.data.tasks.find(item => item.id === target.closest("[data-task-id]").dataset.taskId);
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", body: JSON.stringify({ status: task.status === "done" ? "todo" : "done" }) });
      toast(task.status === "done" ? "Задача возвращена в работу" : "Задача выполнена");
      await refresh();
    } catch (error) { toast(error.message, "error"); }
  }
}

async function sendChat(text) {
  const clean = text.trim();
  if (!clean || state.busy) return;
  state.busy = true;
  elements.chatInput.value = "";
  const pending = document.createElement("div");
  pending.className = "message user";
  pending.textContent = clean;
  elements.chatMessages.append(pending);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
  try {
    const result = await api("/api/dialogue/analyze", { method: "POST", body: JSON.stringify({ text: clean, projectId: state.selectedProjectId }) });
    toast(result.response);
    await refresh();
  } catch (error) {
    pending.remove();
    toast(error.message, "error");
  } finally { state.busy = false; }
}

function configureVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    elements.voiceButton.disabled = true;
    elements.voiceButton.title = "Голосовой ввод не поддерживается этим браузером";
    return;
  }
  const recognition = new Recognition();
  recognition.lang = "ru-RU";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = () => { elements.voiceButton.classList.add("listening"); elements.voiceStatus.textContent = "Слушаю…"; };
  recognition.onend = () => { elements.voiceButton.classList.remove("listening"); elements.voiceStatus.textContent = "Enter — отправить"; };
  recognition.onerror = () => toast("Не удалось распознать речь", "error");
  recognition.onresult = event => {
    const transcript = Array.from(event.results).map(result => result[0].transcript).join(" ");
    elements.chatInput.value = transcript;
    if (event.results[event.results.length - 1].isFinal) sendChat(transcript);
  };
  elements.voiceButton.addEventListener("click", () => recognition.start());
}

let searchTimer;
elements.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  const query = elements.searchInput.value.trim();
  if (!query) { render(); return; }
  searchTimer = setTimeout(async () => {
    try { renderSearch(await api(`/api/search?q=${encodeURIComponent(query)}`), query); }
    catch (error) { toast(error.message, "error"); }
  }, 320);
});

document.querySelectorAll(".nav-item").forEach(button => button.addEventListener("click", () => {
  state.view = button.dataset.view;
  state.selectedProjectId = null;
  elements.searchInput.value = "";
  render();
}));
document.querySelector("#newTaskButton").addEventListener("click", () => openTaskDialog());
document.querySelector("#backupButton").addEventListener("click", async () => {
  try {
    const backup = await api("/api/backups", { method: "POST" });
    toast(`Резервная копия создана: ${backup.fileName}`);
  } catch (error) { toast(error.message, "error"); }
});
document.querySelector("#googleSheetsSyncButton").addEventListener("click", async () => {
  try {
    toast("Синхронизация с Google Таблицей запущена");
    const status = await api("/api/google-sheets/sync", { method: "POST" });
    toast(`Google Таблица обновлена: ${status.projects} проектов, ${status.tasks} задач`);
    await refresh();
  } catch (error) { toast(error.message, "error"); }
});
document.querySelector("#googleConnectButton").addEventListener("click", async () => {
  try {
    await refreshGoogleOAuthStatus();
    elements.googleDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
});
document.querySelector("#googleSignInButton").addEventListener("click", async () => {
  try {
    const result = await api("/api/google/oauth/start", { method: "POST" });
    window.open(result.authorizationUrl, "google-oauth", "popup,width=560,height=720");
    waitForGoogleLogin();
  } catch (error) { toast(error.message, "error"); }
});
document.querySelector("#googleCreateSheetButton").addEventListener("click", async () => {
  try {
    toast("Создаём Google Таблицу…");
    await api("/api/google/oauth/spreadsheet", { method: "POST", body: JSON.stringify({ action: "create", title: "Орбита — задачи" }) });
    await refreshGoogleOAuthStatus();
    await refreshGoogleSheetsStatus();
    toast("Google Таблица создана и подключена");
  } catch (error) { toast(error.message, "error"); }
});
document.querySelector("#googleUseSheetButton").addEventListener("click", async () => {
  const value = document.querySelector("#googleSpreadsheetInput").value.trim();
  if (!value) return toast("Вставьте ссылку или ID таблицы", "error");
  try {
    await api("/api/google/oauth/spreadsheet", { method: "POST", body: JSON.stringify({ action: "connect", value }) });
    await refreshGoogleOAuthStatus();
    await refreshGoogleSheetsStatus();
    toast("Google Таблица подключена");
  } catch (error) { toast(error.message, "error"); }
});
document.querySelector("#googleDisconnectButton").addEventListener("click", async () => {
  try {
    await api("/api/google/oauth/disconnect", { method: "POST" });
    await refreshGoogleOAuthStatus();
    await refreshGoogleSheetsStatus();
    toast("Google-аккаунт отключён");
  } catch (error) { toast(error.message, "error"); }
});
document.querySelectorAll(".close-google-modal").forEach(button => button.addEventListener("click", () => elements.googleDialog.close()));
document.querySelectorAll(".close-modal").forEach(button => button.addEventListener("click", () => elements.taskDialog.close()));
document.querySelectorAll(".close-project-modal").forEach(button => button.addEventListener("click", () => elements.projectDialog.close()));
document.querySelectorAll("[data-prompt]").forEach(button => button.addEventListener("click", () => sendChat(button.dataset.prompt)));
elements.content.addEventListener("click", handleContentClick);
elements.taskForm.addEventListener("submit", submitTask);
elements.projectForm.addEventListener("submit", submitProject);
elements.chatForm.addEventListener("submit", event => { event.preventDefault(); sendChat(elements.chatInput.value); });
elements.chatInput.addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendChat(elements.chatInput.value); }
});

configureVoice();
refresh().catch(error => {
  elements.content.innerHTML = emptyState("Не удалось запустить приложение", error.message);
  toast(error.message, "error");
});
