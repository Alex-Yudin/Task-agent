package ru.orbita.taskagent;

import org.json.JSONException;
import org.json.JSONObject;

final class Project {
    String id;
    String title;
    String description;
    String status;
    String color;
    String author;
    String createdAt;
    String updatedAt;

    JSONObject toJson() throws JSONException {
        JSONObject value = new JSONObject();
        value.put("id", id);
        value.put("title", title);
        value.put("description", description == null ? JSONObject.NULL : description);
        value.put("status", status);
        value.put("color", color);
        value.put("author", author);
        value.put("createdAt", createdAt);
        value.put("updatedAt", updatedAt);
        return value;
    }
}

final class TaskItem {
    String id;
    String projectId;
    String parentTaskId;
    String title;
    String description;
    String status;
    String priority;
    String dueAt;
    String completedAt;
    String author;
    String createdAt;
    String updatedAt;

    JSONObject toJson() throws JSONException {
        JSONObject value = new JSONObject();
        value.put("id", id);
        value.put("projectId", projectId == null ? JSONObject.NULL : projectId);
        value.put("parentTaskId", parentTaskId == null ? JSONObject.NULL : parentTaskId);
        value.put("title", title);
        value.put("description", description == null ? JSONObject.NULL : description);
        value.put("status", status);
        value.put("priority", priority);
        value.put("dueAt", dueAt == null ? JSONObject.NULL : dueAt);
        value.put("completedAt", completedAt == null ? JSONObject.NULL : completedAt);
        value.put("author", author);
        value.put("createdAt", createdAt);
        value.put("updatedAt", updatedAt);
        return value;
    }
}
