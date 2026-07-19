import fs from "node:fs";
import path from "node:path";

export class JsonLogger {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, "app.log");
  }

  write(level, event, details = {}) {
    const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...details });
    fs.appendFileSync(this.filePath, `${entry}\n`, "utf8");
  }

  info(event, details) { this.write("info", event, details); }
  error(event, details) { this.write("error", event, details); }
}

export class NullLogger {
  info() {}
  error() {}
}
