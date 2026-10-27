"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const scrypt = promisify(crypto.scrypt);
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3000);
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(__dirname, "data", "users.sqlite");
const SESSION_COOKIE = "research_session";
const SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const MAX_REQUEST_BYTES = 16 * 1024;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 10;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });
const database = new DatabaseSync(DATABASE_PATH);
database.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_salt BLOB NOT NULL,
    password_hash BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
`);

const findUserByEmail = database.prepare(
  "SELECT id, email, password_salt, password_hash FROM users WHERE email = ?"
);
const insertUser = database.prepare(
  "INSERT INTO users (email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?)"
);
const insertSession = database.prepare(
  "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"
);
const findSessionUser = database.prepare(`
  SELECT users.id, users.email, sessions.expires_at
  FROM sessions JOIN users ON users.id = sessions.user_id
  WHERE sessions.token_hash = ? AND sessions.expires_at > ?
`);
const deleteSession = database.prepare("DELETE FROM sessions WHERE token_hash = ?");
const deleteExpiredSessions = database.prepare("DELETE FROM sessions WHERE expires_at <= ?");

const rateLimits = new Map();
const staticFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.openalex.org; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function sendError(response, statusCode, message) {
  sendJson(response, statusCode, { error: message });
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request must contain valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function getCookie(request, name) {
  const cookies = request.headers.cookie || "";
  for (const item of cookies.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim();
    }
  }
  return "";
}

function digestSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function sessionCookie(token, request, maxAge = SESSION_DURATION_SECONDS) {
  const secure = process.env.NODE_ENV === "production" || Boolean(request.socket.encrypted);
  return [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function publicUser(user) {
  return { id: user.id, email: user.email };
}

function consumeRateLimit(request, action) {
  const now = Date.now();
  const key = `${action}:${request.socket.remoteAddress || "unknown"}`;
  const previous = rateLimits.get(key);
  const current = previous && previous.resetAt > now
    ? previous
    : { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  current.count += 1;
  rateLimits.set(key, current);
  if (rateLimits.size > 1000) {
    for (const [entryKey, value] of rateLimits) {
      if (value.resetAt <= now) rateLimits.delete(entryKey);
    }
  }
  return current.count <= RATE_LIMIT_MAX_ATTEMPTS;
}

function validateCredentials(email, password, registration = false) {
  if (typeof email !== "string" || email.length > 254 || !emailPattern.test(email)) {
    return "Enter a valid email address.";
  }
  if (typeof password !== "string") {
    return "Enter your password.";
  }
  if (password.length > 128) {
    return "Password must be 128 characters or fewer.";
  }
  if (registration && password.length < 12) {
    return "Use a password with at least 12 characters.";
  }
  if (!registration && password.length === 0) {
    return "Enter your password.";
  }
  return "";
}

async function createSession(user, request, response) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = Date.now() + SESSION_DURATION_SECONDS * 1000;
  deleteExpiredSessions.run(Date.now());
  insertSession.run(digestSessionToken(token), user.id, expiresAt);
  sendJson(response, 200, { user: publicUser(user) }, {
    "Set-Cookie": sessionCookie(token, request)
  });
}

async function handleAuth(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/auth/me") {
    const token = getCookie(request, SESSION_COOKIE);
    if (!token) {
      sendError(response, 401, "Not signed in.");
      return;
    }
    const user = findSessionUser.get(digestSessionToken(token), Date.now());
    if (!user) {
      sendError(response, 401, "Not signed in.");
      return;
    }
    sendJson(response, 200, { user: publicUser(user) });
    return;
  }

  if (request.method === "POST") {
    const origin = request.headers.origin;
    const forwardedProtocol = process.env.TRUST_PROXY === "1"
      ? String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim()
      : "";
    const expectedProtocol = forwardedProtocol || (request.socket.encrypted ? "https" : "http");
    const expectedOrigin = `${expectedProtocol}://${request.headers.host}`;
    if (origin && origin !== expectedOrigin) {
      sendError(response, 403, "Request origin is not allowed.");
      return;
    }
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
      sendError(response, 415, "Send the sign-out request as JSON.");
      return;
    }
    const token = getCookie(request, SESSION_COOKIE);
    if (token) deleteSession.run(digestSessionToken(token));
    sendJson(response, 200, { ok: true }, {
      "Set-Cookie": sessionCookie("", request, 0)
    });
    return;
  }

  const isRegistration = url.pathname === "/api/auth/register";
  const isLogin = url.pathname === "/api/auth/login";
  if (request.method !== "POST" || (!isRegistration && !isLogin)) {
    sendError(response, 404, "Authentication endpoint not found.");
    return;
  }
  if (!consumeRateLimit(request, isRegistration ? "register" : "login")) {
    sendError(response, 429, "Too many attempts. Please wait and try again.");
    return;
  }
  if (!String(request.headers["content-type"] || "").startsWith("application/json")) {
    sendError(response, 415, "Send credentials as JSON.");
    return;
  }

  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    sendError(response, 400, "Request must contain a JSON object.");
    return;
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = body.password;
  const validationError = validateCredentials(email, password, isRegistration);
  if (validationError) {
    sendError(response, 400, validationError);
    return;
  }

  if (isRegistration) {
    const salt = crypto.randomBytes(PASSWORD_SALT_LENGTH);
    const passwordHash = await scrypt(password, salt, PASSWORD_LENGTH, { maxmem: 64 * 1024 * 1024 });
    let result;
    try {
      result = insertUser.run(email, salt, passwordHash, Date.now());
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed: users.email")) {
        sendError(response, 409, "An account with this email already exists.");
        return;
      }
      throw error;
    }
    await createSession({ id: Number(result.lastInsertRowid), email }, request, response);
    return;
  }

  const user = findUserByEmail.get(email);
  const salt = user ? user.password_salt : Buffer.alloc(PASSWORD_SALT_LENGTH);
  const expectedHash = user ? user.password_hash : Buffer.alloc(PASSWORD_LENGTH);
  const actualHash = await scrypt(password, salt, PASSWORD_LENGTH, { maxmem: 64 * 1024 * 1024 });
  if (!user || !crypto.timingSafeEqual(actualHash, expectedHash)) {
    sendError(response, 401, "Email or password is incorrect.");
    return;
  }
  await createSession(user, request, response);
}

async function serveStatic(response, pathname) {
  const entry = staticFiles.get(pathname);
  if (!entry) {
    sendError(response, 404, "Page not found.");
    return;
  }
  const filePath = path.join(__dirname, entry[0]);
  const content = await fs.promises.readFile(filePath);
  response.writeHead(200, {
    "Content-Type": entry[1],
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.openalex.org; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  });
  response.end(content);
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const operation = url.pathname.startsWith("/api/auth/")
    ? handleAuth(request, response, url)
    : request.method === "GET"
      ? serveStatic(response, url.pathname)
      : Promise.resolve(sendError(response, 405, "Method not allowed."));

  operation.catch(error => {
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    if (error.statusCode) {
      sendError(response, error.statusCode, error.message);
      return;
    }
    console.error("Request failed.", error);
    sendError(response, 500, "An unexpected server error occurred.");
  });
});

server.listen(PORT, HOST, () => {
  console.log(`ScholarSpace is available at http://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DATABASE_PATH}`);
});

function closeServer() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
