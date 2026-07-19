export class DomainError extends Error {
  constructor(message, code = "DOMAIN_ERROR", status = 400) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity, id) {
    super(`${entity} не найден: ${id}`, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends DomainError {
  constructor(message, details = {}) {
    super(message, "VALIDATION_ERROR", 422);
    this.name = "ValidationError";
    this.details = details;
  }
}
