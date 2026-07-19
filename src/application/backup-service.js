import fs from "node:fs";
import path from "node:path";
import { backup } from "node:sqlite";

export class BackupService {
  constructor({ database, backupDirectory, logger }) {
    this.database = database;
    this.backupDirectory = backupDirectory;
    this.logger = logger;
  }

  async create() {
    fs.mkdirSync(this.backupDirectory, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `tasks-backup-${timestamp}.sqlite`;
    const filePath = path.join(this.backupDirectory, fileName);
    await backup(this.database, filePath, { rate: 64 });
    const size = fs.statSync(filePath).size;
    this.logger.info("backup.created", { fileName, size });
    return { fileName, size, createdAt: new Date().toISOString() };
  }
}
