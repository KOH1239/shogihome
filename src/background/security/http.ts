import path from "node:path";
import { pathToFileURL } from "node:url";
import { CustomScheme, net } from "electron";
import { getBundlePath, isDevelopment, isPreview } from "@/background/proc/env.js";
import { loadAppSettingsOnce } from "@/background/settings.js";
import { getAppLogger } from "@/background/log.js";
import { t } from "@/common/i18n/index.js";

export const APP_SCHEME: CustomScheme = {
  scheme: "app",
  privileges: {
    standard: true,
    secure: true,
  },
} as const;

export function handleApp(req: Request): Response | Promise<Response> {
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const { host, pathname } = new URL(req.url);
  if (host === "bundle") {
    const baseDir = getBundlePath();
    const pathToServe = path.resolve(baseDir, pathname.replace(/^\/+/, ""));
    const relativePath = path.relative(baseDir, pathToServe);
    const isSafe = relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
    if (!isSafe) {
      return new Response("bad", { status: 400 });
    }
    return net.fetch(pathToFileURL(pathToServe).toString());
  }
  return new Response("not found", { status: 404 });
}

export const FILE_SCHEME: CustomScheme = {
  scheme: "user-file",
  privileges: {
    standard: true,
    secure: true,
  },
} as const;

const allowedUserFileExtensions = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"];

export function handleUserFile(req: Request): Response | Promise<Response> {
  if (req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }
  const { host, pathname } = new URL(req.url);
  if (host === "localhost") {
    const ext = path.extname(pathname).toLowerCase();
    if (!allowedUserFileExtensions.includes(ext)) {
      return new Response("not allowed", { status: 403 });
    }
    const fileURL = "file://" + pathname;
    return net.fetch(fileURL);
  }
  return new Response("not found", { status: 404 });
}

type AllowedFastAPIRequest = {
  origin: string;
  basePath: string;
};

function getAllowedFastAPIRequest(): AllowedFastAPIRequest | undefined {
  const fastapiUrl = loadAppSettingsOnce().fastapiUrl;
  if (!fastapiUrl) return;

  // If it's a relative path (e.g., "/stream_explain"), allow localhost origins
  if (fastapiUrl.startsWith("/")) {
    const basePath = fastapiUrl.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";
    return { origin: "http://localhost", basePath };
  }

  try {
    const u = new URL(fastapiUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    const basePath = u.pathname.replace(/\/+$/, "").replace(/\/[^/]*$/, "") || "/";
    return { origin: u.origin, basePath };
  } catch {
    return;
  }
}

function isAllowedFastAPIRequest(url: string): boolean {
  const allowed = getAllowedFastAPIRequest();
  if (!allowed) return false;
  try {
    const u = new URL(url);
    // For relative-path config, match any localhost port
    if (allowed.origin === "http://localhost" && u.hostname === "localhost") {
      if (allowed.basePath === "/") return true;
      return u.pathname === allowed.basePath || u.pathname.startsWith(`${allowed.basePath}/`);
    }
    // For absolute URL config, match origin exactly
    if (u.origin !== allowed.origin) return false;
    if (allowed.basePath === "/") return true;
    return u.pathname === allowed.basePath || u.pathname.startsWith(`${allowed.basePath}/`);
  } catch {
    return false;
  }
}

function validateHTTPRequestMethod(method: string, allowFastAPI: boolean) {
  if (method === "GET") {
    return;
  }
  if ((method === "POST" || method === "OPTIONS") && allowFastAPI) {
    return;
  }
  const e = new Error(t.unexpectedHTTPMethodPleaseReport(method));
  getAppLogger().error(e);
  throw e;
}

const allowedHTTPRequestURLs = [
  { protocol: "app:", host: /^bundle$/ },
  { protocol: "user-file:", host: /^localhost$/ },
  { protocol: "devtools:" },
];

function validateHTTPRequestURL(url: string, allowFastAPI: boolean) {
  if (isDevelopment() || isPreview()) {
    return;
  }
  if (allowFastAPI) {
    return;
  }
  const u = new URL(url);
  for (const allowed of allowedHTTPRequestURLs) {
    if (u.protocol === allowed.protocol && (!allowed.host || allowed.host.test(u.host))) {
      return;
    }
  }
  const e = new Error(t.unexpectedRequestURLPleaseReport(url));
  getAppLogger().error(e);
  throw e;
}

export function validateHTTPRequest(method: string, url: string) {
  // In development mode we allow outgoing requests from the renderer
  // (useful for local API backends, dev servers, etc.). In production
  // we enforce stricter checks below.
  if (isDevelopment() || isPreview()) {
    return;
  }
  const allowFastAPI = isAllowedFastAPIRequest(url);
  validateHTTPRequestMethod(method, allowFastAPI);
  validateHTTPRequestURL(url, allowFastAPI);
}
