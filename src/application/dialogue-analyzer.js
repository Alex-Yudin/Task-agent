function stripQuotes(value) {
  return value.trim().replace(/^[«"']|[»"']$/g, "").trim();
}

function localDueDate(dayOffset, clock) {
  const date = new Date(clock());
  date.setDate(date.getDate() + dayOffset);
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function parseTime(text) {
  const match = text.match(/\b(?:в\s+)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/u);
  return match ? { hours: Number(match[1]), minutes: Number(match[2]), marker: match[0] } : null;
}

function parseExplicitDate(text, clock) {
  const match = text.match(/(?:до|на)?\s*(\d{1,2})[.\/-](\d{1,2})(?:[.\/-](\d{4}))?\b/u);
  if (!match) return null;
  const [, day, month, year] = match;
  const resolvedYear = year ? Number(year) : new Date(clock()).getFullYear();
  const time = parseTime(text.slice(match.index + match[0].length));
  const date = new Date(resolvedYear, Number(month) - 1, Number(day), time?.hours ?? 23, time?.minutes ?? 59, time ? 0 : 59, time ? 0 : 999);
  if (date.getFullYear() !== resolvedYear || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return { dueAt: date.toISOString(), marker: `${match[0]}${time ? ` ${time.marker}` : ""}`.trim() };
}

function extractTaskDetails(raw, clock) {
  let title = stripQuotes(raw.replace(/[.!]+$/u, ""));
  let dueAt = null;
  const explicit = parseExplicitDate(title, clock);
  if (explicit) {
    dueAt = explicit.dueAt;
    title = title.replace(explicit.marker, "").trim();
  } else if (/(?:^|\s)завтра(?=$|[\s,.!?])/iu.test(title)) {
    dueAt = localDueDate(1, clock);
    const time = parseTime(title);
    if (time) {
      const date = new Date(dueAt);
      date.setHours(time.hours, time.minutes, 0, 0);
      dueAt = date.toISOString();
    }
    title = title.replace(/(?:до|на)?\s*завтра(?:\s+в)?\s*(?:[01]?\d|2[0-3])?(?:[:.]\d{2})?/iu, "").trim();
  } else if (/(?:^|\s)сегодня(?=$|[\s,.!?])/iu.test(title)) {
    dueAt = localDueDate(0, clock);
    const time = parseTime(title);
    if (time) {
      const date = new Date(dueAt);
      date.setHours(time.hours, time.minutes, 0, 0);
      dueAt = date.toISOString();
    }
    title = title.replace(/(?:до|на)?\s*сегодня(?:\s+в)?\s*(?:[01]?\d|2[0-3])?(?:[:.]\d{2})?/iu, "").trim();
  }
  let priority = "normal";
  if (/(?:^|\s)срочно(?=$|[\s,:-])/iu.test(title)) priority = "urgent";
  else if (/(?:^|\s)важно(?=$|[\s,:-])/iu.test(title)) priority = "high";
  let urgency = dueAt ? null : "not_urgent";
  if (/(?:^|\s)срочно(?=$|[\s,:-])/iu.test(title)) {
    urgency = "urgent";
    dueAt ||= localDueDate(0, clock);
  } else if (/(?:^|\s)среднесрочно(?=$|[\s,:-])/iu.test(title)) {
    urgency = "medium";
    dueAt ||= localDueDate(1, clock);
  }
  title = title.replace(/(^|\s)(?:срочно|среднесрочно|не\s*срочно|несрочно|важно)(?=$|[\s,:-])[\s,:-]*/giu, "$1").trim();
  return { title: stripQuotes(title), dueAt, priority, ...(urgency ? { urgency } : {}) };
}

export class RuleBasedDialogueAnalyzer {
  constructor({ clock = () => new Date() } = {}) {
    this.clock = clock;
  }

  analyze(input) {
    const text = input.trim();

    const project = text.match(/^(?:создай|добавь|заведи)\s+(?:новый\s+)?проект\s*:?[\s«"']*(.+?)[»"']?[.!]?$/iu);
    if (project) {
      return { intent: "create_project", confidence: 0.98, parameters: { title: stripQuotes(project[1]) } };
    }

    const idea = text.match(/^(?:(?:запиши|сохрани|добавь)\s+)?(?:иде(?:я|ю)(?:\s+на\s+будущее)?|на\s+будущее|когда-нибудь)\s*:?[\s«"']*(.+?)[»"']?[.!]?$/iu)
      || text.match(/^(?:было\s+бы\s+(?:неплохо|хорошо)|можно\s+было\s+бы|хочу\s+когда-нибудь)\s+(.+?)[.!]?$/iu);
    if (idea) {
      return { intent: "create_idea", confidence: 0.97, parameters: { title: stripQuotes(idea[1]) } };
    }

    const completion = text.match(/^(?:заверши|закрой|выполни|отметь\s+(?:как\s+)?выполненной)\s+(?:задачу\s*:?[\s«"']*)?(.+?)[»"']?[.!]?$/iu);
    if (completion) {
      return { intent: "complete_task", confidence: 0.93, parameters: { title: stripQuotes(completion[1]) } };
    }

    const projectTask = text.match(/^(?:(?:создай|добавь|запиши)\s+)?(?:задача|задачу|подзадача|подзадачу)\s+(?:в|для)\s+проект(?:а)?\s*[«"']?(.+?)[»"']?\s*:\s*(.+?)[.!]?$/iu)
      || text.match(/^(?:в|для)\s+проект(?:е|а)?\s*[«"']?(.+?)[»"']?\s+(?:задача|подзадача)\s*:\s*(.+?)[.!]?$/iu);
    if (projectTask) {
      return {
        intent: "create_task",
        confidence: 0.97,
        parameters: { ...extractTaskDetails(projectTask[2], this.clock), projectTitle: stripQuotes(projectTask[1]) }
      };
    }

    const task = text.match(/^(?:(?:создай|добавь|запиши|поставь)\s+(?:новую\s+)?(?:задачу|дело)|задача)\s*:?[\s«"']*(.+?)[»"']?[.!]?$/iu);
    if (task) {
      return { intent: "create_task", confidence: 0.96, parameters: extractTaskDetails(task[1], this.clock) };
    }


    const naturalTask = text.match(/^(?:мне\s+)?(?:нужно|надо|необходимо|следует|не\s+забыть)\s+(.+?)[.!]?$/iu);
    if (naturalTask) {
      return { intent: "create_task", confidence: 0.84, parameters: extractTaskDetails(naturalTask[1], this.clock) };
    }

    const search = text.match(/^(?:найди|поищи|поиск)\s*:?[\s«"']*(.+?)[»"']?[.!]?$/iu);
    if (search) {
      return { intent: "search", confidence: 0.95, parameters: { query: stripQuotes(search[1]) } };
    }

    if (/(?:план|задачи|дела)\s+на\s+сегодня|что\s+(?:у\s+меня\s+)?на\s+сегодня/iu.test(text)) {
      return { intent: "daily_plan", confidence: 0.96, parameters: {} };
    }

    return { intent: "conversation", confidence: 0.35, parameters: { text, category: "unclassified" } };
  }
}
