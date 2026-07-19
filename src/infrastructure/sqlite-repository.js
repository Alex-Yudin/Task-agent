import { randomUUID } from "node:crypto";

function projectRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    color: row.color,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskCount: row.task_count ?? undefined,
    completedTaskCount: row.completed_task_count ?? undefined
  };
}

function taskRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    projectTitle: row.project_title ?? null,
    parentTaskId: row.parent_task_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    completedAt: row.completed_at,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    subtaskCount: row.subtask_count ?? 0,
    completedSubtaskCount: row.completed_subtask_count ?? 0
  };
}

export class SqliteRepository {
  constructor(database) {
    this.db = database;
  }

  transaction(callback) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createProject(project) {
    this.db.prepare(`
      INSERT INTO projects(id, title, description, status, color, author, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(project.id, project.title, project.description, project.status, project.color,
      project.author, project.createdAt, project.updatedAt);
    return this.getProject(project.id);
  }

  getProject(id) {
    return projectRow(this.db.prepare(`
      SELECT p.*,
        COUNT(t.id) AS task_count,
        COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS completed_task_count
      FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
      WHERE p.id = ? GROUP BY p.id
    `).get(id));
  }

  findProjectByTitle(title) {
    return projectRow(this.db.prepare(`
      SELECT * FROM projects
      WHERE lower(title) = lower(?) OR lower(title) LIKE lower(?)
      ORDER BY CASE WHEN lower(title) = lower(?) THEN 0 ELSE 1 END, updated_at DESC LIMIT 1
    `).get(title, `%${title}%`, title));
  }

  listProjects({ status } = {}) {
    const filter = status ? "WHERE p.status = ?" : "";
    const params = status ? [status] : [];
    return this.db.prepare(`
      SELECT p.*,
        COUNT(t.id) AS task_count,
        COALESCE(SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END), 0) AS completed_task_count
      FROM projects p LEFT JOIN tasks t ON t.project_id = p.id
      ${filter} GROUP BY p.id
      ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, p.updated_at DESC
    `).all(...params).map(projectRow);
  }

  updateProject(id, changes) {
    const fields = [];
    const params = [];
    const mapping = { title: "title", description: "description", status: "status", color: "color" };
    for (const [key, column] of Object.entries(mapping)) {
      if (changes[key] !== undefined) {
        fields.push(`${column} = ?`);
        params.push(changes[key]);
      }
    }
    if (!fields.length) return this.getProject(id);
    fields.push("updated_at = ?");
    params.push(changes.updatedAt, id);
    this.db.prepare(`UPDATE projects SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    return this.getProject(id);
  }

  createTask(task) {
    this.db.prepare(`
      INSERT INTO tasks(id, project_id, parent_task_id, title, description, status, priority,
        due_at, completed_at, author, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(task.id, task.projectId, task.parentTaskId, task.title, task.description, task.status,
      task.priority, task.dueAt, task.completedAt, task.author, task.createdAt, task.updatedAt);
    return this.getTask(task.id);
  }

  getTask(id) {
    return taskRow(this.db.prepare(`
      SELECT t.*, p.title AS project_title,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id) AS subtask_count,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.status = 'done') AS completed_subtask_count
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id WHERE t.id = ?
    `).get(id));
  }

  findTaskByTitle(title) {
    return taskRow(this.db.prepare(`
      SELECT t.*, p.title AS project_title
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status NOT IN ('done','cancelled')
        AND (lower(t.title) = lower(?) OR lower(t.title) LIKE lower(?))
      ORDER BY CASE WHEN lower(t.title) = lower(?) THEN 0 ELSE 1 END, t.updated_at DESC LIMIT 1
    `).get(title, `%${title}%`, title));
  }

  listTasks({ projectId, status, parentTaskId, dueBefore, dueAfter, limit = 200 } = {}) {
    const where = [];
    const params = [];
    if (projectId) { where.push("t.project_id = ?"); params.push(projectId); }
    if (status) { where.push("t.status = ?"); params.push(status); }
    if (parentTaskId === null) where.push("t.parent_task_id IS NULL");
    else if (parentTaskId) { where.push("t.parent_task_id = ?"); params.push(parentTaskId); }
    if (dueBefore) { where.push("t.due_at IS NOT NULL AND t.due_at <= ?"); params.push(dueBefore); }
    if (dueAfter) { where.push("t.due_at IS NOT NULL AND t.due_at >= ?"); params.push(dueAfter); }
    params.push(Math.min(Math.max(Number(limit) || 200, 1), 500));
    return this.db.prepare(`
      SELECT t.*, p.title AS project_title,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id) AS subtask_count,
        (SELECT COUNT(*) FROM tasks s WHERE s.parent_task_id = t.id AND s.status = 'done') AS completed_subtask_count
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY
        CASE t.status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at, t.created_at DESC
      LIMIT ?
    `).all(...params).map(taskRow);
  }

  updateTask(id, changes) {
    const fields = [];
    const params = [];
    const mapping = {
      projectId: "project_id", parentTaskId: "parent_task_id", title: "title",
      description: "description", status: "status", priority: "priority", dueAt: "due_at",
      completedAt: "completed_at"
    };
    for (const [key, column] of Object.entries(mapping)) {
      if (changes[key] !== undefined) {
        fields.push(`${column} = ?`);
        params.push(changes[key]);
      }
    }
    if (!fields.length) return this.getTask(id);
    fields.push("updated_at = ?");
    params.push(changes.updatedAt, id);
    this.db.prepare(`UPDATE tasks SET ${fields.join(", ")} WHERE id = ?`).run(...params);
    return this.getTask(id);
  }

  addDialogue(message) {
    this.db.prepare(`
      INSERT INTO dialogues(id, role, content, result_json, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(message.id, message.role, message.content, message.resultJson,
      message.author, message.createdAt);
    return message;
  }

  listDialogues(limit = 100) {
    return this.db.prepare(`
      SELECT id, role, content, result_json, author, created_at
      FROM dialogues ORDER BY created_at DESC LIMIT ?
    `).all(Math.min(Math.max(Number(limit) || 100, 1), 500)).map(row => ({
      id: row.id, role: row.role, content: row.content,
      result: row.result_json ? JSON.parse(row.result_json) : null,
      author: row.author, createdAt: row.created_at
    })).reverse();
  }

  addActivity({ entityType, entityId, action, details, author, createdAt }) {
    this.db.prepare(`
      INSERT INTO activity_log(entity_type, entity_id, action, details_json, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(entityType, entityId, action, details ? JSON.stringify(details) : null, author, createdAt);
  }

  listActivity(limit = 100) {
    return this.db.prepare(`
      SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?
    `).all(Math.min(Math.max(Number(limit) || 100, 1), 500)).map(row => ({
      id: row.id, entityType: row.entity_type, entityId: row.entity_id,
      action: row.action, details: row.details_json ? JSON.parse(row.details_json) : null,
      author: row.author, createdAt: row.created_at
    }));
  }

  getDashboard({ startOfDay, endOfDay, now }) {
    const stats = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM projects WHERE status = 'active') AS active_projects,
        (SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done','cancelled')) AS open_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status = 'done') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done','cancelled') AND due_at < ?) AS overdue_tasks,
        (SELECT COUNT(*) FROM tasks WHERE status NOT IN ('done','cancelled') AND due_at BETWEEN ? AND ?) AS today_tasks
    `).get(now, startOfDay, endOfDay);

    const today = this.db.prepare(`
      SELECT t.*, p.title AS project_title
      FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.status NOT IN ('done','cancelled') AND t.due_at <= ?
      ORDER BY CASE WHEN t.due_at < ? THEN 0 ELSE 1 END,
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, t.due_at
      LIMIT 20
    `).all(endOfDay, now).map(taskRow);

    return {
      stats: {
        activeProjects: stats.active_projects,
        openTasks: stats.open_tasks,
        completedTasks: stats.completed_tasks,
        overdueTasks: stats.overdue_tasks,
        todayTasks: stats.today_tasks
      },
      today
    };
  }

  search(query, limit = 50) {
    const pattern = `%${query}%`;
    return this.db.prepare(`
      SELECT 'project' AS type, id, title, description AS snippet, updated_at AS changed_at FROM projects
      WHERE title LIKE ? OR description LIKE ?
      UNION ALL
      SELECT 'task', id, title, description, updated_at FROM tasks
      WHERE title LIKE ? OR description LIKE ?
      UNION ALL
      SELECT 'dialogue', id, substr(content, 1, 160), content, created_at FROM dialogues
      WHERE content LIKE ?
      UNION ALL
      SELECT kind, id, title, content, updated_at FROM knowledge_items
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY changed_at DESC LIMIT ?
    `).all(pattern, pattern, pattern, pattern, pattern, pattern, pattern,
      Math.min(Math.max(Number(limit) || 50, 1), 100)).map(row => ({
        type: row.type, id: row.id, title: row.title, snippet: row.snippet, changedAt: row.changed_at
      }));
  }

  newId() {
    return randomUUID();
  }
}
