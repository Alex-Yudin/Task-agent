import { ValidationError } from "./errors.js";

export const PROJECT_STATUSES = Object.freeze(["active", "paused", "completed", "archived"]);
export const TASK_STATUSES = Object.freeze(["todo", "in_progress", "done", "cancelled"]);
export const TASK_PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);

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
