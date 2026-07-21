import { ValidationError } from "./errors.js";

export const PROJECT_STATUSES = Object.freeze(["active", "paused", "completed", "archived"]);
export const TASK_STATUSES = Object.freeze(["todo", "in_progress", "done", "cancelled"]);
export const TASK_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
export const TASK_URGENCIES = Object.freeze(["urgent", "medium", "not_urgent"]);
export const IDEA_STATUSES = Object.freeze(["new", "planned", "converted", "archived"]);

export function requireText(value, field, maxLength = 300) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new ValidationError(`Поле «${field}» обязательно`);
  if (normalized.length > maxLength) {
    throw new ValidationError(`Поле «${field}» не должно превышать ${maxLength} символов`);
  }
  return normalized;
}

export function optionalText(value, maxLength = 5000) {
  if (value === undefined || value === null || value === "") return null;
  const normalized = String(value).trim();
  if (normalized.length > maxLength) {
    throw new ValidationError(`Текст не должен превышать ${maxLength} символов`);
  }
  return normalized || null;
}

export function oneOf(value, values, field, fallback) {
  const resolved = value ?? fallback;
  if (!values.includes(resolved)) {
    throw new ValidationError(`Недопустимое значение поля «${field}»`);
  }
  return resolved;
}

export function optionalIsoDate(value, field = "срок") {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new ValidationError(`Некорректная дата: ${field}`);
  return date.toISOString();
}

export function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

export function taskTiming({ urgency, dueAt, clock = () => new Date() }) {
  let normalizedDueAt = optionalIsoDate(dueAt);
  let normalizedUrgency = urgency === undefined || urgency === null || urgency === ""
    ? null
    : oneOf(urgency, TASK_URGENCIES, "Срочность");

  if (normalizedDueAt) {
    const now = new Date(clock());
    const due = new Date(normalizedDueAt);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const dayDifference = Math.round((dueDay - today) / 86_400_000);
    normalizedUrgency = dayDifference <= 0 ? "urgent" : dayDifference === 1 ? "medium" : "not_urgent";
  } else if (normalizedUrgency === "urgent" || normalizedUrgency === "medium") {
    const deadline = new Date(clock());
    if (normalizedUrgency === "medium") deadline.setDate(deadline.getDate() + 1);
    deadline.setHours(23, 59, 59, 999);
    normalizedDueAt = deadline.toISOString();
  }

  return { urgency: normalizedUrgency || "not_urgent", dueAt: normalizedDueAt };
}
