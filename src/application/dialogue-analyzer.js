function stripQuotes(value) {
  return value.trim().replace(/^[«"']|[»"']$/g, "").trim();
}

function localDueDate(dayOffset, clock) {
  const date = new Date(clock());
  date.setDate(date.getDate() + dayOffset);
  date.setHours(18, 0, 0, 0);
  return date.toISOString();
}

function parseExplicitDate(text) {
  const match = text.match(/(?:до|на)\s+(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})\b/u);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 18, 0, 0, 0);
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return { dueAt: date.toISOString(), marker: match[0] };
}

function extractTaskDetails(raw, clock) {
  let title = stripQuotes(raw.replace(/[.!]+$/u, ""));
  let dueAt = null;
  const explicit = parseExplicitDate(title);
  if (explicit) {
    dueAt = explicit.dueAt;
    title = title.replace(explicit.marker, "").trim();
  } else if (/(?:до|на)\s+завтра(?=$|[\s,.!?])/iu.test(title)) {
    dueAt = localDueDate(1, clock);
    title = title.replace(/(?:до|на)\s+завтра(?=$|[\s,.!?])/iu, "").trim();
  } else if (/(?:до|на)\s+сегодня(?=$|[\s,.!?])/iu.test(title)) {
    dueAt = localDueDate(0, clock);
    title = title.replace(/(?:до|на)\s+сегодня(?=$|[\s,.!?])/iu, "").trim();
  }
  let priority = "normal";
  if (/(?:^|\s)срочно(?=$|[\s,:-])/iu.test(title)) priority = "urgent";
  else if (/(?:^|\s)важно(?=$|[\s,:-])/iu.test(title)) priority = "high";
  title = title.replace(/(^|\s)(?:срочно|важно)(?=$|[\s,:-])[\s,:-]*/giu, "$1").trim();
  return { title: stripQuotes(title), dueAt, priority };
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

    const completion = text.match(/^(?:заверши|закрой|выполни|отметь\s+(?:как\s+)?выполненной)\s+(?:задачу\s*:?[\s«"']*)?(.+?)[»"']?[.!]?$/iu);
    if (completion) {
      return { intent: "complete_task", confidence: 0.93, parameters: { title: stripQuotes(completion[1]) } };
    }

    const task = text.match(/^(?:(?:создай|добавь|запиши|поставь)\s+(?:новую\s+)?(?:задачу|дело)|задача)\s*:?[\s«"']*(.+?)[»"']?[.!]?$/iu);
    if (task) {
      return { intent: "create_task", confidence: 0.96, parameters: extractTaskDetails(task[1], this.clock) };
    }

    const search = text.match(/^(?:найди|поищи|поиск)\s*:?[\s«"']*(.+?)[»"']?[.!]?$/iu);
    if (search) {
      return { intent: "search", confidence: 0.95, parameters: { query: stripQuotes(search[1]) } };
    }

    if (/(?:план|задачи|дела)\s+на\s+сегодня|что\s+(?:у\s+меня\s+)?на\s+сегодня/iu.test(text)) {
      return { intent: "daily_plan", confidence: 0.96, parameters: {} };
    }

    return { intent: "conversation", confidence: 0.35, parameters: { text } };
  }
}
