package ru.orbita.taskagent;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

final class LocalDatabase extends SQLiteOpenHelper {
    private static final String NAME = "orbita-mobile.sqlite";
    private static final int VERSION = 1;

    LocalDatabase(Context context) {
        super(context, NAME, null, VERSION);
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onConfigure(SQLiteDatabase db) {
        db.setForeignKeyConstraintsEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE projects (" +
                "id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL," +
                "color TEXT NOT NULL, author TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        db.execSQL("CREATE TABLE tasks (" +
                "id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL," +
                "parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE, title TEXT NOT NULL," +
                "description TEXT, status TEXT NOT NULL, priority TEXT NOT NULL, due_at TEXT," +
                "completed_at TEXT, author TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
        db.execSQL("CREATE INDEX idx_mobile_tasks_status_due ON tasks(status, due_at)");
        db.execSQL("CREATE INDEX idx_mobile_tasks_project ON tasks(project_id)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // Миграции следующих версий добавляются здесь без потери пользовательских данных.
    }

    Project createProject(String title) {
        String now = Instant.now().toString();
        Project project = new Project();
        project.id = UUID.randomUUID().toString();
        project.title = title.trim();
        project.description = null;
        project.status = "active";
        project.color = "#6C5CE7";
        project.author = "Android";
        project.createdAt = now;
        project.updatedAt = now;
        getWritableDatabase().insertOrThrow("projects", null, projectValues(project));
        return project;
    }

    TaskItem createTask(String title, String projectId, String priority, String dueAt) {
        String now = Instant.now().toString();
        TaskItem task = new TaskItem();
        task.id = UUID.randomUUID().toString();
        task.projectId = emptyToNull(projectId);
        task.parentTaskId = null;
        task.title = title.trim();
        task.description = null;
        task.status = "todo";
        task.priority = priority;
        task.dueAt = emptyToNull(dueAt);
        task.completedAt = null;
        task.author = "Android";
        task.createdAt = now;
        task.updatedAt = now;
        getWritableDatabase().insertOrThrow("tasks", null, taskValues(task));
        return task;
    }

    void setTaskDone(String taskId, boolean done) {
        ContentValues values = new ContentValues();
        values.put("status", done ? "done" : "todo");
        values.put("updated_at", Instant.now().toString());
        if (done) values.put("completed_at", Instant.now().toString());
        else values.putNull("completed_at");
        getWritableDatabase().update("tasks", values, "id = ?", new String[]{taskId});
    }

    List<Project> projects() {
        List<Project> values = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT * FROM projects ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, updated_at DESC", null)) {
            while (cursor.moveToNext()) values.add(readProject(cursor));
        }
        return values;
    }

    List<TaskItem> tasks() {
        List<TaskItem> values = new ArrayList<>();
        try (Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT * FROM tasks ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END," +
                        " CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END," +
                        " CASE WHEN due_at IS NULL THEN 1 ELSE 0 END, due_at, created_at DESC", null)) {
            while (cursor.moveToNext()) values.add(readTask(cursor));
        }
        return values;
    }

    int count(String table, String where) {
        String query = "SELECT COUNT(*) FROM " + table + (where == null ? "" : " WHERE " + where);
        try (Cursor cursor = getReadableDatabase().rawQuery(query, null)) {
            cursor.moveToFirst();
            return cursor.getInt(0);
        }
    }

    String projectTitle(String id) {
        if (id == null) return "Без проекта";
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT title FROM projects WHERE id = ?", new String[]{id})) {
            return cursor.moveToFirst() ? cursor.getString(0) : "Без проекта";
        }
    }

    void applyRemote(JSONArray projects, JSONArray tasks) throws Exception {
        SQLiteDatabase db = getWritableDatabase();
        db.beginTransaction();
        try {
            for (int index = 0; index < projects.length(); index++) upsertProject(db, projects.getJSONObject(index));
            for (int index = 0; index < tasks.length(); index++) upsertTask(db, tasks.getJSONObject(index));
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
    }

    private void upsertProject(SQLiteDatabase db, JSONObject json) throws Exception {
        Project project = new Project();
        project.id = json.getString("id");
        project.title = json.getString("title");
        project.description = nullable(json, "description");
        project.status = json.getString("status");
        project.color = json.optString("color", "#6C5CE7");
        project.author = json.optString("author", "Windows");
        project.createdAt = json.getString("createdAt");
        project.updatedAt = json.getString("updatedAt");
        String current = existingTimestamp(db, "projects", project.id);
        if (current != null && current.compareTo(project.updatedAt) >= 0) return;
        ContentValues values = projectValues(project);
        if (current == null) db.insertOrThrow("projects", null, values);
        else db.update("projects", values, "id = ?", new String[]{project.id});
    }

    private void upsertTask(SQLiteDatabase db, JSONObject json) throws Exception {
        TaskItem task = new TaskItem();
        task.id = json.getString("id");
        task.projectId = nullable(json, "projectId");
        task.parentTaskId = nullable(json, "parentTaskId");
        task.title = json.getString("title");
        task.description = nullable(json, "description");
        task.status = json.getString("status");
        task.priority = json.optString("priority", "normal");
        task.dueAt = nullable(json, "dueAt");
        task.completedAt = nullable(json, "completedAt");
        task.author = json.optString("author", "Windows");
        task.createdAt = json.getString("createdAt");
        task.updatedAt = json.getString("updatedAt");
        String current = existingTimestamp(db, "tasks", task.id);
        if (current != null && current.compareTo(task.updatedAt) >= 0) return;
        ContentValues values = taskValues(task);
        if (current == null) db.insertOrThrow("tasks", null, values);
        else db.update("tasks", values, "id = ?", new String[]{task.id});
    }

    private String existingTimestamp(SQLiteDatabase db, String table, String id) {
        try (Cursor cursor = db.rawQuery("SELECT updated_at FROM " + table + " WHERE id = ?", new String[]{id})) {
            return cursor.moveToFirst() ? cursor.getString(0) : null;
        }
    }

    private ContentValues projectValues(Project project) {
        ContentValues values = new ContentValues();
        values.put("id", project.id); values.put("title", project.title); values.put("description", project.description);
        values.put("status", project.status); values.put("color", project.color); values.put("author", project.author);
        values.put("created_at", project.createdAt); values.put("updated_at", project.updatedAt);
        return values;
    }

    private ContentValues taskValues(TaskItem task) {
        ContentValues values = new ContentValues();
        values.put("id", task.id); values.put("project_id", task.projectId); values.put("parent_task_id", task.parentTaskId);
        values.put("title", task.title); values.put("description", task.description); values.put("status", task.status);
        values.put("priority", task.priority); values.put("due_at", task.dueAt); values.put("completed_at", task.completedAt);
        values.put("author", task.author); values.put("created_at", task.createdAt); values.put("updated_at", task.updatedAt);
        return values;
    }

    private Project readProject(Cursor cursor) {
        Project value = new Project();
        value.id = text(cursor, "id"); value.title = text(cursor, "title"); value.description = text(cursor, "description");
        value.status = text(cursor, "status"); value.color = text(cursor, "color"); value.author = text(cursor, "author");
        value.createdAt = text(cursor, "created_at"); value.updatedAt = text(cursor, "updated_at");
        return value;
    }

    private TaskItem readTask(Cursor cursor) {
        TaskItem value = new TaskItem();
        value.id = text(cursor, "id"); value.projectId = text(cursor, "project_id"); value.parentTaskId = text(cursor, "parent_task_id");
        value.title = text(cursor, "title"); value.description = text(cursor, "description"); value.status = text(cursor, "status");
        value.priority = text(cursor, "priority"); value.dueAt = text(cursor, "due_at"); value.completedAt = text(cursor, "completed_at");
        value.author = text(cursor, "author"); value.createdAt = text(cursor, "created_at"); value.updatedAt = text(cursor, "updated_at");
        return value;
    }

    private static String text(Cursor cursor, String column) {
        int index = cursor.getColumnIndexOrThrow(column);
        return cursor.isNull(index) ? null : cursor.getString(index);
    }

    private static String nullable(JSONObject json, String key) {
        return json.isNull(key) ? null : json.optString(key, null);
    }

    private static String emptyToNull(String value) {
        return value == null || value.trim().isEmpty() ? null : value;
    }
}
