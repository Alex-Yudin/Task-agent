import fs from "node:fs";
import { DomainError } from "../domain/errors.js";

const EPOCH = "1970-01-01T00:00:00.000Z";

export class GoogleSheetsSyncService {
  constructor({ config, syncService, logger, fetchImpl = fetch, clock = () => new Date() }) {
    this.config = config.googleSheets;
    this.syncService = syncService;
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.timer = null;
    this.interval = null;
    this.pending = null;
    this.state = {
      enabled: Boolean(this.config.enabled),
      configured: false,
      inProgress: false,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      lastReason: null,
      projects: 0,
      tasks: 0
    };
    this.refreshConfigured();
  }

  start() {
    if (!this.config.enabled) return;
    this.schedule("startup", 1000);
    this.interval = setInterval(() => this.schedule("interval", 0), this.config.intervalSeconds * 1000);
    this.interval.unref();
  }

  close() {
    if (this.timer) clearTimeout(this.timer);
    if (this.interval) clearInterval(this.interval);
    this.timer = null;
    this.interval = null;
  }

  schedule(reason = "changed", delay = this.config.debounceMilliseconds) {
    if (!this.config.enabled) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.synchronize(reason).catch(() => {});
    }, delay);
    this.timer.unref();
  }

  status() {
    this.refreshConfigured();
    return { ...this.state };
  }

  async synchronize(reason = "manual") {
    if (!this.config.enabled) throw new DomainError("Синхронизация с Google Таблицей отключена", "GOOGLE_SHEETS_DISABLED", 409);
    if (this.pending) return this.pending;
    this.pending = this.perform(reason).finally(() => { this.pending = null; });
    return this.pending;
  }

  async perform(reason) {
    const credentials = this.credentials();
    this.state.inProgress = true;
    this.state.lastAttemptAt = this.clock().toISOString();
    this.state.lastReason = reason;
    this.state.lastError = null;
    try {
      const snapshot = this.syncService.pull(EPOCH);
      const response = await this.fetchImpl(credentials.webAppUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8", "Accept": "application/json" },
        body: JSON.stringify({
          action: "sync",
          protocolVersion: 1,
          clientId: "orbita-windows",
          secret: credentials.secret,
          projects: snapshot.projects,
          tasks: snapshot.tasks
        }),
        signal: AbortSignal.timeout(30000)
      });
      const text = await response.text();
      let remote;
      try { remote = JSON.parse(text); }
      catch { throw new Error(`Google Apps Script вернул не JSON (HTTP ${response.status})`); }
      if (!response.ok || remote.ok === false) {
        throw new Error(remote.error?.message || remote.message || `HTTP ${response.status}`);
      }
      const projects = Array.isArray(remote.projects) ? remote.projects : [];
      const tasks = Array.isArray(remote.tasks) ? remote.tasks : [];
      this.syncService.push({ deviceId: "google-sheets", projects, tasks });
      this.state.lastSuccessAt = remote.serverTime || this.clock().toISOString();
      this.state.projects = projects.length;
      this.state.tasks = tasks.length;
      this.logger.info("google-sheets.synchronized", { reason, projects: projects.length, tasks: tasks.length });
      return this.status();
    } catch (error) {
      this.state.lastError = error.message;
      this.logger.error("google-sheets.error", { reason, error: error.message });
      throw new DomainError(`Google Таблица: ${error.message}`, "GOOGLE_SHEETS_SYNC_FAILED", 502);
    } finally {
      this.state.inProgress = false;
    }
  }

  refreshConfigured() {
    this.state.configured = Boolean(this.config.enabled && fs.existsSync(this.config.credentialsFile));
  }

  credentials() {
    this.refreshConfigured();
    if (!this.state.configured) {
      throw new DomainError("Сначала выполните configure-google-sheets.cmd", "GOOGLE_SHEETS_NOT_CONFIGURED", 409);
    }
    let value;
    try { value = JSON.parse(fs.readFileSync(this.config.credentialsFile, "utf8")); }
    catch { throw new DomainError("Некорректный файл data/google-sheets-sync.json", "GOOGLE_SHEETS_INVALID_CONFIG", 409); }
    const webAppUrl = String(value.webAppUrl || "").trim();
    const secret = String(value.secret || "").trim();
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/u.test(webAppUrl)) {
      throw new DomainError("Укажите опубликованный URL Google Apps Script, оканчивающийся на /exec", "GOOGLE_SHEETS_INVALID_URL", 409);
    }
    if (secret.length < 24) throw new DomainError("Секрет синхронизации должен содержать не менее 24 символов", "GOOGLE_SHEETS_INVALID_SECRET", 409);
    return { webAppUrl, secret };
  }
}
