import fs from "node:fs";
import path from "node:path";

export function loadConfig(rootDirectory) {
  const filePath = path.join(rootDirectory, "appsettings.json");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  return {
    ...raw,
    rootDirectory,
    dataDirectory: path.resolve(rootDirectory, raw.dataDirectory),
    backupDirectory: path.resolve(rootDirectory, raw.backupDirectory)
  };
}
