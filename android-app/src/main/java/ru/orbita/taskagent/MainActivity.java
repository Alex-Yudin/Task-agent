package ru.orbita.taskagent;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.speech.RecognizerIntent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import android.widget.Toast;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int PURPLE = Color.rgb(108, 92, 231);
    private static final int PURPLE_DARK = Color.rgb(81, 67, 190);
    private static final int INK = Color.rgb(30, 29, 45);
    private static final int MUTED = Color.rgb(112, 109, 128);
    private static final int CANVAS = Color.rgb(247, 246, 250);
    private static final int LINE = Color.rgb(232, 229, 239);
    private static final int VOICE_REQUEST = 301;
    private static final int AUDIO_PERMISSION = 302;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private LocalDatabase database;
    private SharedPreferences preferences;
    private LinearLayout content;
    private TextView syncStatus;
    private String screen = "dashboard";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        database = new LocalDatabase(this);
        preferences = getSharedPreferences("orbita", MODE_PRIVATE);
        ensureDeviceId();
        setContentView(buildApplication());
        showDashboard();
        if (!preferences.getString("sync_token", "").trim().isEmpty()) synchronize(false);
    }

    private View buildApplication() {
        LinearLayout root = column();
        root.setBackgroundColor(CANVAS);

        LinearLayout header = row();
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(15), dp(12), dp(15));
        header.setBackgroundColor(PURPLE_DARK);
        TextView title = text("Орбита", 23, Color.WHITE, true);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        header.addView(title, titleParams);
        Button voice = button("🎙 Команда", false);
        voice.setTextColor(Color.WHITE);
        voice.setBackground(rounded(Color.argb(42, 255, 255, 255), 12));
        voice.setOnClickListener(view -> beginVoice());
        header.addView(voice);
        root.addView(header);

        syncStatus = text("Локальный режим", 11, MUTED, false);
        syncStatus.setPadding(dp(18), dp(8), dp(18), dp(7));
        syncStatus.setBackgroundColor(Color.WHITE);
        root.addView(syncStatus, matchWrap());

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        content = column();
        content.setPadding(dp(15), dp(15), dp(15), dp(25));
        scroll.addView(content, matchWrap());
        root.addView(scroll, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        LinearLayout navigation = row();
        navigation.setBackgroundColor(Color.WHITE);
        navigation.setPadding(dp(5), dp(5), dp(5), dp(8));
        addNavigation(navigation, "Обзор", "dashboard");
        addNavigation(navigation, "Проекты", "projects");
        addNavigation(navigation, "Задачи", "tasks");
        addNavigation(navigation, "Настройки", "settings");
        root.addView(navigation, matchWrap());
        return root;
    }

    private void addNavigation(LinearLayout navigation, String label, String destination) {
        Button item = new Button(this);
        item.setText(label);
        item.setTextSize(11);
        item.setTextColor(INK);
        item.setAllCaps(false);
        item.setBackgroundColor(Color.TRANSPARENT);
        item.setPadding(dp(2), dp(8), dp(2), dp(8));
        item.setOnClickListener(view -> navigate(destination));
        navigation.addView(item, new LinearLayout.LayoutParams(0, dp(48), 1));
    }

    private void navigate(String destination) {
        screen = destination;
        if ("projects".equals(destination)) showProjects();
        else if ("tasks".equals(destination)) showTasks();
        else if ("settings".equals(destination)) showSettings();
        else showDashboard();
    }

    private void clear(String title, String subtitle) {
        content.removeAllViews();
        content.addView(text(title, 25, INK, true));
        TextView hint = text(subtitle, 12, MUTED, false);
        hint.setPadding(0, dp(3), 0, dp(16));
        content.addView(hint);
    }

    private void showDashboard() {
        screen = "dashboard";
        clear(greeting(), "Ваш рабочий план на сегодня");
        int activeProjects = database.count("projects", "status = 'active'");
        int openTasks = database.count("tasks", "status NOT IN ('done','cancelled')");
        int completed = database.count("tasks", "status = 'done'");
        int overdue = overdueCount(database.tasks());

        LinearLayout focus = column();
        focus.setPadding(dp(18), dp(18), dp(18), dp(18));
        focus.setBackground(rounded(PURPLE, 18));
        focus.addView(text(openTasks == 0 ? "План свободен" : "В фокусе — " + openTasks + " открытых задач", 20, Color.WHITE, true));
        TextView focusHint = text(overdue == 0 ? "Просроченных задач нет" : "Просрочено: " + overdue, 12, Color.rgb(230, 226, 255), false);
        focusHint.setPadding(0, dp(6), 0, 0);
        focus.addView(focusHint);
        content.addView(focus, marginBottom(dp(14)));

        LinearLayout firstStats = row();
        firstStats.addView(stat("Проекты", activeProjects), weightedCard());
        firstStats.addView(stat("Открытые", openTasks), weightedCard());
        content.addView(firstStats, marginBottom(dp(8)));
        LinearLayout secondStats = row();
        secondStats.addView(stat("Выполнено", completed), weightedCard());
        secondStats.addView(stat("Просрочено", overdue), weightedCard());
        content.addView(secondStats, marginBottom(dp(18)));

        content.addView(sectionTitle("Ближайшие задачи"));
        List<TaskItem> tasks = database.tasks();
        int shown = 0;
        for (TaskItem task : tasks) {
            if ("done".equals(task.status) || "cancelled".equals(task.status)) continue;
            content.addView(taskCard(task));
            if (++shown == 6) break;
        }
        if (shown == 0) content.addView(empty("Добавьте первую задачу — вручную или голосом."));

        Button sync = button("Синхронизировать", true);
        sync.setOnClickListener(view -> synchronize(true));
        content.addView(sync, marginTop(dp(18)));
    }

    private void showProjects() {
        screen = "projects";
        clear("Проекты", "Общие для Windows и Android");
        Button add = button("＋ Новый проект", true);
        add.setOnClickListener(view -> projectDialog(null));
        content.addView(add, marginBottom(dp(14)));
        List<Project> projects = database.projects();
        for (Project project : projects) {
            LinearLayout card = card();
            card.addView(text(project.title, 17, INK, true));
            TextView status = text(projectStatus(project.status), 11, PURPLE, false);
            status.setPadding(0, dp(5), 0, dp(2));
            card.addView(status);
            content.addView(card, marginBottom(dp(9)));
        }
        if (projects.isEmpty()) content.addView(empty("Проектов пока нет."));
    }

    private void showTasks() {
        screen = "tasks";
        clear("Задачи", "Работают офлайн и синхронизируются позже");
        Button add = button("＋ Новая задача", true);
        add.setOnClickListener(view -> taskDialog(null));
        content.addView(add, marginBottom(dp(14)));
        List<TaskItem> tasks = database.tasks();
        for (TaskItem task : tasks) content.addView(taskCard(task));
        if (tasks.isEmpty()) content.addView(empty("Задач пока нет."));
    }

    private void showSettings() {
        screen = "settings";
        clear("Синхронизация", "Google Таблица через интернет или компьютер в локальной сети");
        LinearLayout form = card();
        form.addView(label("Адрес синхронизации"));
        EditText server = input("URL Google Apps Script /exec или адрес компьютера");
        server.setText(preferences.getString("sync_url", ""));
        form.addView(server, marginBottom(dp(12)));
        form.addView(label("Секрет Google Таблицы или локальный токен"));
        EditText token = input("Секрет синхронизации");
        token.setText(preferences.getString("sync_token", ""));
        form.addView(token, marginBottom(dp(12)));
        TextView device = text("Устройство: " + preferences.getString("device_id", ""), 10, MUTED, false);
        device.setPadding(0, 0, 0, dp(12));
        form.addView(device);
        Button save = button("Сохранить и синхронизировать", true);
        save.setOnClickListener(view -> {
            preferences.edit().putString("sync_url", server.getText().toString().trim())
                    .putString("sync_token", token.getText().toString().trim()).apply();
            hideKeyboard();
            synchronize(true);
        });
        form.addView(save);
        content.addView(form);

        String last = preferences.getString("last_sync", "");
        TextView lastSync = text(last.trim().isEmpty() ? "Синхронизация ещё не выполнялась" : "Последняя синхронизация: " + formatDate(last), 11, MUTED, false);
        lastSync.setPadding(dp(4), dp(13), dp(4), dp(8));
        content.addView(lastSync);
        content.addView(empty("Для облачной синхронизации вставьте URL опубликованного Google Apps Script и секрет setupOrbita. Локальная синхронизация с Windows также поддерживается."));
    }

    private View stat(String label, int value) {
        LinearLayout card = card();
        card.setPadding(dp(14), dp(13), dp(14), dp(13));
        card.addView(text(label, 11, MUTED, false));
        TextView number = text(String.valueOf(value), 23, INK, true);
        number.setPadding(0, dp(4), 0, 0);
        card.addView(number);
        return card;
    }

    private View taskCard(TaskItem task) {
        LinearLayout card = row();
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(11), dp(9), dp(11), dp(9));
        card.setBackground(rounded(Color.WHITE, 12));
        CheckBox done = new CheckBox(this);
        done.setChecked("done".equals(task.status));
        done.setOnCheckedChangeListener((button, checked) -> {
            database.setTaskDone(task.id, checked);
            synchronize(false);
            if ("dashboard".equals(screen)) showDashboard(); else showTasks();
        });
        card.addView(done);
        LinearLayout body = column();
        TextView title = text(task.title, 14, "done".equals(task.status) ? MUTED : INK, true);
        body.addView(title);
        String meta = database.projectTitle(task.projectId) + " · " + priority(task.priority);
        if (task.dueAt != null) meta += " · " + formatDate(task.dueAt);
        body.addView(text(meta, 10, MUTED, false));
        card.addView(body, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        return withMargin(card, 0, 0, 0, dp(8));
    }

    private void projectDialog(String initialTitle) {
        EditText title = input("Название проекта");
        if (initialTitle != null) title.setText(initialTitle);
        new AlertDialog.Builder(this)
                .setTitle("Новый проект")
                .setView(padded(title))
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Создать", (dialog, which) -> {
                    String value = title.getText().toString().trim();
                    if (value.isEmpty()) toast("Введите название проекта");
                    else { database.createProject(value); synchronize(false); showProjects(); }
                }).show();
    }

    private void taskDialog(String initialTitle) {
        LinearLayout form = column();
        form.setPadding(dp(20), dp(2), dp(20), 0);
        EditText title = input("Что нужно сделать?");
        if (initialTitle != null) title.setText(initialTitle);
        form.addView(title, marginBottom(dp(10)));
        List<Project> projects = database.projects();
        List<String> projectNames = new ArrayList<>();
        projectNames.add("Без проекта");
        for (Project project : projects) projectNames.add(project.title);
        Spinner project = new Spinner(this);
        project.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, projectNames));
        form.addView(project, marginBottom(dp(10)));
        Spinner priority = new Spinner(this);
        priority.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
                new String[]{"Обычный", "Высокий", "Срочный", "Низкий"}));
        form.addView(priority);
        new AlertDialog.Builder(this)
                .setTitle("Новая задача")
                .setView(form)
                .setNegativeButton("Отмена", null)
                .setPositiveButton("Добавить", (dialog, which) -> {
                    String value = title.getText().toString().trim();
                    if (value.isEmpty()) { toast("Введите название задачи"); return; }
                    String projectId = project.getSelectedItemPosition() == 0 ? null : projects.get(project.getSelectedItemPosition() - 1).id;
                    String[] priorities = {"normal", "high", "urgent", "low"};
                    database.createTask(value, projectId, priorities[priority.getSelectedItemPosition()], null);
                    synchronize(false);
                    if ("dashboard".equals(screen)) showDashboard(); else showTasks();
                }).show();
    }

    private void synchronize(boolean notify) {
        String url = preferences.getString("sync_url", "");
        String token = preferences.getString("sync_token", "");
        if (url.trim().isEmpty() || token.trim().isEmpty()) {
            if (notify) { toast("Сначала заполните настройки синхронизации"); showSettings(); }
            return;
        }
        syncStatus.setText("Синхронизация…");
        executor.submit(() -> {
            try {
                SyncClient.Result result = new SyncClient().synchronize(database, url, token,
                        preferences.getString("device_id", "android"), preferences.getString("last_sync", ""));
                preferences.edit().putString("last_sync", result.serverTime).apply();
                runOnUiThread(() -> {
                    syncStatus.setText("Синхронизировано · проектов: " + result.projectCount + ", задач: " + result.taskCount);
                    navigate(screen);
                    if (notify) toast("Синхронизация завершена");
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    syncStatus.setText("Нет связи с хранилищем");
                    if (notify) toast(error.getMessage() == null ? "Ошибка синхронизации" : error.getMessage());
                });
            }
        });
    }

    private void beginVoice() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION);
            return;
        }
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU");
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Скажите команду");
        try { startActivityForResult(intent, VOICE_REQUEST); }
        catch (Exception error) { toast("На устройстве нет службы распознавания речи"); }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == AUDIO_PERMISSION && grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) beginVoice();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != VOICE_REQUEST || resultCode != RESULT_OK || data == null) return;
        ArrayList<String> results = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (results == null || results.isEmpty()) return;
        handleVoice(results.get(0));
    }

    private void handleVoice(String command) {
        String value = command.trim();
        String lower = value.toLowerCase(Locale.forLanguageTag("ru-RU"));
        if (lower.startsWith("создай проект ")) {
            String title = value.substring("создай проект ".length()).trim();
            if (!title.isEmpty()) { database.createProject(title); synchronize(false); toast("Проект создан"); showProjects(); return; }
        }
        String[] prefixes = {"создай задачу ", "добавь задачу ", "задача "};
        for (String prefix : prefixes) {
            if (lower.startsWith(prefix)) {
                String title = value.substring(prefix.length()).replaceFirst("(?iu)\\s+(до|на)\\s+завтра$", "").trim();
                String due = lower.matches(".*\\s+(до|на)\\s+завтра$")
                        ? LocalDate.now().plusDays(1).atTime(18, 0).atZone(ZoneId.systemDefault()).toInstant().toString() : null;
                String priority = lower.contains("срочно") ? "urgent" : lower.contains("важно") ? "high" : "normal";
                title = title.replaceFirst("(?iu)^(срочно|важно)[,:-]?\\s*", "");
                database.createTask(title, null, priority, due);
                synchronize(false);
                toast("Задача добавлена"); showTasks(); return;
            }
        }
        taskDialog(value);
    }

    private void ensureDeviceId() {
        if (preferences.getString("device_id", "").trim().isEmpty()) {
            preferences.edit().putString("device_id", "android-" + UUID.randomUUID()).apply();
        }
    }

    private String greeting() {
        int hour = java.time.LocalTime.now().getHour();
        if (hour < 6) return "Доброй ночи";
        if (hour < 12) return "Доброе утро";
        if (hour < 18) return "Добрый день";
        return "Добрый вечер";
    }

    private int overdueCount(List<TaskItem> tasks) {
        int count = 0;
        Instant now = Instant.now();
        for (TaskItem task : tasks) {
            if (task.dueAt != null && !"done".equals(task.status) && !"cancelled".equals(task.status)) {
                try { if (Instant.parse(task.dueAt).isBefore(now)) count++; } catch (Exception ignored) {}
            }
        }
        return count;
    }

    private String formatDate(String value) {
        try {
            return DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm").withZone(ZoneId.systemDefault()).format(Instant.parse(value));
        } catch (Exception error) { return value; }
    }

    private String priority(String value) {
        if ("urgent".equals(value)) return "Срочно";
        if ("high".equals(value)) return "Высокий";
        if ("low".equals(value)) return "Низкий";
        return "Обычный";
    }

    private String projectStatus(String value) {
        if ("completed".equals(value)) return "Завершён";
        if ("paused".equals(value)) return "На паузе";
        if ("archived".equals(value)) return "Архив";
        return "Активный";
    }

    private LinearLayout card() {
        LinearLayout value = column();
        value.setPadding(dp(15), dp(14), dp(15), dp(14));
        value.setBackground(rounded(Color.WHITE, 13));
        return value;
    }

    private TextView sectionTitle(String value) {
        TextView title = text(value, 18, INK, true);
        title.setPadding(dp(2), dp(3), 0, dp(10));
        return title;
    }

    private TextView empty(String value) {
        TextView text = text(value, 12, MUTED, false);
        text.setGravity(Gravity.CENTER);
        text.setPadding(dp(18), dp(24), dp(18), dp(24));
        text.setBackground(rounded(Color.WHITE, 12));
        return text;
    }

    private TextView label(String value) {
        TextView label = text(value, 11, MUTED, true);
        label.setPadding(0, 0, 0, dp(5));
        return label;
    }

    private EditText input(String hint) {
        EditText value = new EditText(this);
        value.setHint(hint);
        value.setTextSize(13);
        value.setTextColor(INK);
        value.setSingleLine(true);
        value.setPadding(dp(11), dp(10), dp(11), dp(10));
        value.setBackground(rounded(Color.rgb(244, 242, 248), 9));
        return value;
    }

    private Button button(String label, boolean primary) {
        Button value = new Button(this);
        value.setText(label);
        value.setTextSize(13);
        value.setTextColor(primary ? Color.WHITE : INK);
        value.setAllCaps(false);
        value.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        value.setPadding(dp(13), dp(9), dp(13), dp(9));
        value.setBackground(rounded(primary ? PURPLE : Color.WHITE, 10));
        return value;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        if (bold) text.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return text;
    }

    private LinearLayout row() { LinearLayout value = new LinearLayout(this); value.setOrientation(LinearLayout.HORIZONTAL); return value; }
    private LinearLayout column() { LinearLayout value = new LinearLayout(this); value.setOrientation(LinearLayout.VERTICAL); return value; }
    private GradientDrawable rounded(int color, int radius) { GradientDrawable value = new GradientDrawable(); value.setColor(color); value.setCornerRadius(dp(radius)); return value; }
    private LinearLayout.LayoutParams matchWrap() { return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT); }
    private LinearLayout.LayoutParams weightedCard() { LinearLayout.LayoutParams value = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1); value.setMargins(dp(4), 0, dp(4), 0); return value; }
    private LinearLayout.LayoutParams marginBottom(int margin) { LinearLayout.LayoutParams value = matchWrap(); value.bottomMargin = margin; return value; }
    private LinearLayout.LayoutParams marginTop(int margin) { LinearLayout.LayoutParams value = matchWrap(); value.topMargin = margin; return value; }
    private View withMargin(View view, int left, int top, int right, int bottom) { LinearLayout.LayoutParams value = matchWrap(); value.setMargins(left, top, right, bottom); view.setLayoutParams(value); return view; }
    private View padded(View view) { LinearLayout wrapper = column(); wrapper.setPadding(dp(20), 0, dp(20), 0); wrapper.addView(view); return wrapper; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void toast(String value) { Toast.makeText(this, value, Toast.LENGTH_LONG).show(); }
    private void hideKeyboard() { ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE)).hideSoftInputFromWindow(content.getWindowToken(), 0); }

    @Override
    protected void onDestroy() {
        executor.shutdownNow();
        database.close();
        super.onDestroy();
    }
}
