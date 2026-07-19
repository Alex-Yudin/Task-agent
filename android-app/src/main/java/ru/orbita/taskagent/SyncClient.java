package ru.orbita.taskagent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;

final class SyncClient {
    static final class Result {
        final String serverTime;
        final int projectCount;
        final int taskCount;

        Result(String serverTime, int projectCount, int taskCount) {
            this.serverTime = serverTime;
            this.projectCount = projectCount;
            this.taskCount = taskCount;
        }
    }

    Result synchronize(LocalDatabase database, String rawBaseUrl, String token, String deviceId, String since) throws Exception {
        String baseUrl = normalize(rawBaseUrl);
        if (token == null || token.trim().isEmpty()) throw new IllegalArgumentException("Укажите токен синхронизации");

        if (baseUrl.startsWith("https://script.google.com/macros/s/") && baseUrl.endsWith("/exec")) {
            return synchronizeGoogleSheets(database, baseUrl, token, deviceId);
        }

        JSONObject push = new JSONObject();
        push.put("protocolVersion", 1);
        push.put("deviceId", deviceId);
        push.put("projects", projects(database.projects()));
        push.put("tasks", tasks(database.tasks()));
        request("POST", baseUrl + "/sync/v1/push", token, push.toString());

        String cursor = since == null || since.trim().isEmpty() ? "1970-01-01T00:00:00.000Z" : since;
        JSONObject pull = request("GET", baseUrl + "/sync/v1/pull?since=" +
                URLEncoder.encode(cursor, "UTF-8"), token, null);
        JSONArray projectValues = pull.getJSONArray("projects");
        JSONArray taskValues = pull.getJSONArray("tasks");
        database.applyRemote(projectValues, taskValues);
        return new Result(pull.getString("serverTime"), projectValues.length(), taskValues.length());
    }

    private Result synchronizeGoogleSheets(LocalDatabase database, String url, String secret, String deviceId) throws Exception {
        JSONObject payload = new JSONObject();
        payload.put("action", "sync");
        payload.put("protocolVersion", 1);
        payload.put("clientId", deviceId);
        payload.put("secret", secret.trim());
        payload.put("projects", projects(database.projects()));
        payload.put("tasks", tasks(database.tasks()));
        JSONObject result = request("POST", url, secret, payload.toString());
        if (!result.optBoolean("ok", false)) {
            String message = result.optJSONObject("error") == null
                    ? "Google Таблица отклонила синхронизацию"
                    : result.optJSONObject("error").optString("message", "Ошибка Google Таблицы");
            throw new IllegalStateException(message);
        }
        JSONArray projectValues = result.optJSONArray("projects");
        JSONArray taskValues = result.optJSONArray("tasks");
        if (projectValues == null) projectValues = new JSONArray();
        if (taskValues == null) taskValues = new JSONArray();
        database.applyRemote(projectValues, taskValues);
        return new Result(result.optString("serverTime", java.time.Instant.now().toString()),
                projectValues.length(), taskValues.length());
    }

    private JSONArray projects(List<Project> values) throws Exception {
        JSONArray array = new JSONArray();
        for (Project value : values) array.put(value.toJson());
        return array;
    }

    private JSONArray tasks(List<TaskItem> values) throws Exception {
        JSONArray array = new JSONArray();
        for (TaskItem value : values) array.put(value.toJson());
        return array;
    }

    private JSONObject request(String method, String address, String token, String body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) URI.create(address).toURL().openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("Authorization", "Bearer " + token.trim());
        if (body != null) {
            connection.setDoOutput(true);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            try (OutputStream output = connection.getOutputStream()) {
                output.write(body.getBytes(StandardCharsets.UTF_8));
            }
        }
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300 ? connection.getInputStream() : connection.getErrorStream();
        String response = read(stream);
        connection.disconnect();
        if (status < 200 || status >= 300) {
            String message = response;
            try { message = new JSONObject(response).getJSONObject("error").getString("message"); } catch (Exception ignored) {}
            throw new IllegalStateException("Синхронизация: " + message);
        }
        return new JSONObject(response);
    }

    private String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line);
        }
        return result.toString();
    }

    private String normalize(String value) {
        if (value == null || value.trim().isEmpty()) throw new IllegalArgumentException("Укажите адрес синхронизации");
        String result = value.trim();
        while (result.endsWith("/")) result = result.substring(0, result.length() - 1);
        if (!result.startsWith("http://") && !result.startsWith("https://")) result = "http://" + result;
        return result;
    }
}
