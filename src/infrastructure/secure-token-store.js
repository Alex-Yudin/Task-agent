import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export class SecureTokenStore {
  constructor({ filePath, dpapiScript, platform = process.platform }) {
    this.filePath = filePath;
    this.dpapiScript = dpapiScript;
    this.platform = platform;
  }

  exists() { return fs.existsSync(this.filePath); }

  load() {
    if (!this.exists()) return null;
    const stored = fs.readFileSync(this.filePath, "utf8").trim();
    if (!stored) return null;
    const json = this.platform === "win32" ? this.dpapi("unprotect", stored) : stored;
    try { return JSON.parse(json.replace(/^\uFEFF/u, "")); }
    catch { throw new Error("Не удалось прочитать сохранённую авторизацию Google"); }
  }

  save(value) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const json = JSON.stringify(value);
    const stored = this.platform === "win32" ? this.dpapi("protect", json) : json;
    fs.writeFileSync(this.filePath, `${stored}\n`, { encoding: "utf8", mode: 0o600 });
  }

  clear() {
    if (this.exists()) fs.unlinkSync(this.filePath);
  }

  dpapi(mode, input) {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-File", this.dpapiScript, mode
    ], { input, encoding: "utf8", windowsHide: true, maxBuffer: 1024 * 1024 });
    if (result.status !== 0 || !result.stdout?.trim()) {
      throw new Error(`Windows DPAPI: ${result.stderr?.trim() || "операция не выполнена"}`);
    }
    return result.stdout.trim();
  }
}
