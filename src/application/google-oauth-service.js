import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError } from "../domain/errors.js";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file"
];

function base64Url(value) { return Buffer.from(value).toString("base64url"); }

export class GoogleOAuthService {
  constructor({ config, tokenStore, credentialsStore = null, fetchImpl = fetch, clock = () => new Date(), logger, environment = process.env }) {
    this.config = config.googleOAuth;
    this.tokenStore = tokenStore;
    this.credentialsStore = credentialsStore;
    this.fetchImpl = fetchImpl;
    this.clock = clock;
    this.logger = logger;
    this.environment = environment;
    this.pending = null;
  }

  status() {
    let tokens = null;
    let credentials = null;
    let error = null;
    try { tokens = this.tokenStore.load(); } catch (loadError) { error = loadError.message; }
    try { credentials = this.credentials(); } catch (credentialsError) { error = credentialsError.message; }
    return {
      enabled: Boolean(this.config.enabled),
      configured: Boolean(this.config.enabled && credentials?.clientId),
      clientSecretConfigured: Boolean(credentials?.clientSecret),
      connected: Boolean(tokens?.refreshToken || tokens?.accessToken),
      account: tokens?.account || null,
      error
    };
  }

  begin() {
    const credentials = this.credentials();
    if (!this.config.enabled || !credentials.clientId) {
      throw new DomainError("Desktop OAuth Client ID не настроен", "GOOGLE_OAUTH_NOT_CONFIGURED", 409);
    }
    if (!credentials.clientSecret) {
      throw new DomainError("Не добавлен локальный OAuth Client JSON. Запустите configure-google-oauth.cmd и выберите JSON, скачанный из Google Cloud", "GOOGLE_OAUTH_CLIENT_CREDENTIALS_REQUIRED", 409);
    }
    const verifier = base64Url(randomBytes(48));
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const state = base64Url(randomBytes(32));
    this.pending = { verifier, state, clientId: credentials.clientId, createdAt: this.clock().valueOf() };
    const url = new URL(AUTHORIZATION_ENDPOINT);
    url.searchParams.set("client_id", credentials.clientId);
    url.searchParams.set("redirect_uri", this.config.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", SCOPES.join(" "));
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return { authorizationUrl: url.toString(), expiresInSeconds: 600 };
  }

  async complete({ code, state, error }) {
    if (error) throw new DomainError(`Google отклонил вход: ${error}`, "GOOGLE_OAUTH_DENIED", 400);
    const pending = this.pending;
    this.pending = null;
    if (!pending || this.clock().valueOf() - pending.createdAt > 10 * 60 * 1000) {
      throw new DomainError("Запрос входа истёк. Запустите авторизацию снова", "GOOGLE_OAUTH_EXPIRED", 400);
    }
    const expected = Buffer.from(pending.state);
    const supplied = Buffer.from(String(state || ""));
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new DomainError("Некорректное состояние OAuth", "GOOGLE_OAUTH_INVALID_STATE", 400);
    }
    if (!code) throw new DomainError("Google не вернул код авторизации", "GOOGLE_OAUTH_MISSING_CODE", 400);

    const credentials = this.credentials();
    if (credentials.clientId !== pending.clientId) {
      throw new DomainError("OAuth Client изменился во время входа. Запустите авторизацию снова", "GOOGLE_OAUTH_CLIENT_CHANGED", 409);
    }
    const token = await this.tokenRequest({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      code,
      code_verifier: pending.verifier,
      grant_type: "authorization_code",
      redirect_uri: this.config.redirectUri
    });
    const account = await this.userInfo(token.access_token);
    this.tokenStore.save({
      accessToken: token.access_token,
      refreshToken: token.refresh_token || null,
      expiresAt: this.clock().valueOf() + Number(token.expires_in || 3600) * 1000,
      scope: token.scope || SCOPES.join(" "),
      account: { email: account.email, name: account.name || account.email, picture: account.picture || null }
    });
    this.logger.info("google-oauth.connected", { email: account.email });
    return this.status();
  }

  async accessToken() {
    const stored = this.tokenStore.load();
    if (!stored) throw new DomainError("Войдите через Google", "GOOGLE_OAUTH_REQUIRED", 401);
    if (stored.accessToken && Number(stored.expiresAt) > this.clock().valueOf() + 60_000) return stored.accessToken;
    if (!stored.refreshToken) {
      this.tokenStore.clear();
      throw new DomainError("Сеанс Google истёк. Войдите снова", "GOOGLE_OAUTH_EXPIRED", 401);
    }
    const credentials = this.credentials();
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new DomainError("Запустите configure-google-oauth.cmd и добавьте OAuth Client JSON", "GOOGLE_OAUTH_CLIENT_CREDENTIALS_REQUIRED", 409);
    }
    const token = await this.tokenRequest({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: stored.refreshToken,
      grant_type: "refresh_token"
    });
    const refreshed = {
      ...stored,
      accessToken: token.access_token,
      refreshToken: token.refresh_token || stored.refreshToken,
      expiresAt: this.clock().valueOf() + Number(token.expires_in || 3600) * 1000,
      scope: token.scope || stored.scope
    };
    this.tokenStore.save(refreshed);
    return refreshed.accessToken;
  }

  async disconnect() {
    let stored = null;
    try { stored = this.tokenStore.load(); } catch {}
    const token = stored?.refreshToken || stored?.accessToken;
    if (token) {
      try {
        await this.fetchImpl(REVOKE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(10000)
        });
      } catch (revokeError) {
        this.logger.error("google-oauth.revoke-failed", { error: revokeError.message });
      }
    }
    this.tokenStore.clear();
    return this.status();
  }

  async userInfo(accessToken) {
    const response = await this.fetchImpl(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new DomainError(body.error_description || "Не удалось получить профиль Google", "GOOGLE_OAUTH_PROFILE_FAILED", 502);
    return body;
  }

  async tokenRequest(parameters) {
    const response = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(parameters),
      signal: AbortSignal.timeout(15000)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.access_token) {
      if (/client_secret.*missing/iu.test(`${body.error || ""} ${body.error_description || ""}`)) {
        throw new DomainError("Google требует client_secret. Запустите configure-google-oauth.cmd и выберите OAuth Client JSON", "GOOGLE_OAUTH_CLIENT_CREDENTIALS_REQUIRED", 409);
      }
      throw new DomainError(body.error_description || body.error || "Ошибка получения Google-токена", "GOOGLE_OAUTH_TOKEN_FAILED", 502);
    }
    return body;
  }

  credentials() {
    const stored = this.credentialsStore?.load?.() || {};
    const source = stored.installed || stored.web || stored;
    const configuredClientId = String(this.config.clientId || "").trim();
    const storedClientId = String(source.client_id || source.clientId || "").trim();
    if (configuredClientId && storedClientId && configuredClientId !== storedClientId) {
      throw new DomainError("Выбран OAuth Client JSON от другого Client ID", "GOOGLE_OAUTH_CLIENT_ID_MISMATCH", 409);
    }
    return {
      clientId: storedClientId || configuredClientId,
      clientSecret: String(this.environment.ORBITA_GOOGLE_CLIENT_SECRET || source.client_secret || source.clientSecret || "").trim()
    };
  }
}
