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
    },
    googleSheets: {
      enabled: raw.googleSheets?.enabled !== false,
      credentialsFile: path.resolve(rootDirectory, raw.googleSheets?.credentialsFile || "data/google-sheets-sync.json"),
      intervalSeconds: Math.max(Number(raw.googleSheets?.intervalSeconds) || 300, 30),
      debounceMilliseconds: Math.max(Number(raw.googleSheets?.debounceMilliseconds) || 500, 100)
    },
    googleOAuth: {
      enabled: raw.googleOAuth?.enabled !== false,
      clientId: String(raw.googleOAuth?.clientId || "").trim(),
      clientCredentialsFile: path.resolve(rootDirectory, raw.googleOAuth?.clientCredentialsFile || "data/google-oauth-client.dat"),
      redirectUri: raw.googleOAuth?.redirectUri || `http://127.0.0.1:${raw.port || 3765}/api/google/oauth/callback`,
      tokenFile: path.resolve(rootDirectory, raw.googleOAuth?.tokenFile || "data/google-oauth-tokens.dat"),
      spreadsheetFile: path.resolve(rootDirectory, raw.googleOAuth?.spreadsheetFile || "data/google-oauth-spreadsheet.json"),
      dpapiScript: path.resolve(rootDirectory, "scripts/dpapi-token.ps1")
    }
  };
}
