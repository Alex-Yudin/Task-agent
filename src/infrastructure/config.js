import fs from "node:fs";
import path from "node:path";

export function loadConfig(rootDirectory) {
  const filePath = path.join(rootDirectory, "appsettings.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    ...raw,
    rootDirectory,
    dataDirectory: path.resolve(rootDirectory, raw.dataDirectory),
    backupDirectory: path.resolve(rootDirectory, raw.backupDirectory),
    sync: {
      enabled: raw.sync?.enabled !== false,
      host: raw.sync?.host || "0.0.0.0",
      port: raw.sync?.port || 3766,
      tokenFile: path.resolve(rootDirectory, raw.sync?.tokenFile || "data/sync-token.txt")
    }
  };
}
