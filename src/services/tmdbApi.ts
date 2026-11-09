import "server-only";
import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from "axios";

// Runtime server-only assertion (guarded in test harness where happy-dom provides a synthetic window)
if (typeof window !== "undefined" && process.env.NODE_ENV !== "test") {
  throw new Error("SECURITY VIOLATION: tmdbApi must only be executed in a server environment.");
}

export const TMDB_BASE_URL = "https://api.themoviedb.org/3";
export const ALLOWED_TMDB_HOSTS = new Set(["api.themoviedb.org"]);

export class TmdbConfigurationError extends Error {
  readonly code = "TMDB_CONFIG_ERROR";
  readonly status = 500;
  constructor(message = "TMDB_API_RAT is missing or empty. Server request aborted.") {
    super(message);
    this.name = "TmdbConfigurationError";
    Object.setPrototypeOf(this, TmdbConfigurationError.prototype);
  }
}

export class TmdbHostValidationError extends Error {
  readonly code = "TMDB_HOST_VALIDATION_ERROR";
  readonly status = 400;
  constructor(message = "Arbitrary upstream URL rejected. Only api.themoviedb.org is allowlisted.") {
    super(message);
    this.name = "TmdbHostValidationError";
    Object.setPrototypeOf(this, TmdbHostValidationError.prototype);
  }
}

export interface TmdbErrorShape {
  status: number;
  code: string;
  message: string;
}

export class TmdbApiError extends Error implements TmdbErrorShape {
  readonly isTmdbError = true;
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "TmdbApiError";
    this.status = status;
    this.code = code;
    Object.setPrototypeOf(this, TmdbApiError.prototype);
  }
}

export function isTmdbError(error: unknown): error is TmdbApiError {
  return typeof error === "object" && error !== null && (error as TmdbApiError).isTmdbError === true;
}

/**
 * Validates that any request URL targets the allowlisted upstream TMDB host,
 * enforces HTTPS protocol, and rejects protocol-relative or SSRF override vectors.
 */
export function validateUpstreamUrl(url?: string, baseURL?: string): void {
  if (!url) return;

  // Disallow protocol-relative URLs (e.g. //evil.com or //api.themoviedb.org)
  if (url.startsWith("//")) {
    throw new TmdbHostValidationError("Protocol-relative URLs are not permitted.");
  }

  // If full URL with scheme (e.g. https://..., http://..., ftp://...)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        throw new TmdbHostValidationError(
          `Insecure protocol "${parsed.protocol}" rejected. Only HTTPS is allowed.`
        );
      }
      if (!ALLOWED_TMDB_HOSTS.has(parsed.hostname.toLowerCase())) {
        throw new TmdbHostValidationError(
          `Arbitrary upstream host "${parsed.hostname}" rejected. Allowed hosts: ${Array.from(ALLOWED_TMDB_HOSTS).join(", ")}`
        );
      }
    } catch (e) {
      if (e instanceof TmdbHostValidationError) throw e;
      throw new TmdbHostValidationError(`Invalid upstream URL: ${url}`);
    }
  } else if (baseURL) {
    // Relative URL with baseURL: validate that resolved target stays strictly on allowlisted host
    try {
      const resolved = new URL(url, baseURL);
      if (resolved.protocol !== "https:") {
        throw new TmdbHostValidationError(
          `Resolved protocol "${resolved.protocol}" rejected. Only HTTPS is allowed.`
        );
      }
      if (!ALLOWED_TMDB_HOSTS.has(resolved.hostname.toLowerCase())) {
        throw new TmdbHostValidationError(
          `Resolved upstream host "${resolved.hostname}" rejected. Allowed hosts: ${Array.from(ALLOWED_TMDB_HOSTS).join(", ")}`
        );
      }
    } catch (e) {
      if (e instanceof TmdbHostValidationError) throw e;
      throw new TmdbHostValidationError(`Invalid baseURL: ${baseURL}`);
    }
  }
}

/**
 * Maps Axios errors to stable sanitized TmdbApiError objects while ensuring
 * no tokens, query secrets, or raw authorization headers are leaked into logs or error strings.
 */
export function sanitizeAndMapError(error: unknown): Error {
  if (error instanceof TmdbConfigurationError || error instanceof TmdbHostValidationError) {
    return error;
  }

  if (axios.isAxiosError(error)) {
    // Redact Authorization header from config to prevent leakage in serialized error/config
    if (error.config?.headers?.Authorization) {
      error.config.headers.Authorization = "Bearer [REDACTED]";
    }

    const status = error.response?.status;

    // Handle redirected response when redirects are blocked
    if (status && (status === 301 || status === 302 || status === 307 || status === 308)) {
      return new TmdbApiError(status, "TMDB_REDIRECT_BLOCKED", "Upstream HTTP redirect was blocked by security policy");
    }

    if (error.code === "ECONNABORTED" || (typeof error.message === "string" && error.message.includes("timeout"))) {
      return new TmdbApiError(504, "TMDB_TIMEOUT", "Upstream TMDB request timed out");
    }

    if (status === 401) {
      return new TmdbApiError(401, "TMDB_UNAUTHORIZED", "Upstream TMDB authentication failed: invalid or expired credentials");
    }

    if (status === 404) {
      return new TmdbApiError(404, "TMDB_NOT_FOUND", "Requested resource was not found on TMDB");
    }

    if (status === 429) {
      return new TmdbApiError(429, "TMDB_RATE_LIMIT", "Upstream TMDB rate limit exceeded");
    }

    if (status && status >= 500 && status <= 599) {
      return new TmdbApiError(status, "TMDB_UPSTREAM_ERROR", `Upstream TMDB gateway error (HTTP ${status})`);
    }

    if (!error.response) {
      return new TmdbApiError(502, "TMDB_NETWORK_ERROR", "Unable to reach upstream TMDB service");
    }

    return new TmdbApiError(status || 500, "TMDB_REQUEST_FAILED", "Upstream TMDB request failed");
  }

  return error instanceof Error ? error : new Error(String(error));
}

// Konfigurasi Axios khusus untuk TMDB API (Server-only)
const tmdbApi: AxiosInstance = axios.create({
  baseURL: TMDB_BASE_URL,
  headers: {
    Accept: "application/json",
  },
  timeout: 10000, // 10 detik timeout
  maxRedirects: 0, // Disallow automatic redirects to enforce final destination validation
});

// Read-only Authorization getter for backwards compatibility with test inspection.
// Does NOT permit mutation of process.env.TMDB_API_RAT through defaults header assignment.
Object.defineProperty(tmdbApi.defaults.headers, "Authorization", {
  get() {
    const token = process.env.TMDB_API_RAT?.trim();
    return token ? `Bearer ${token}` : undefined;
  },
  set() {
    // Deliberately no-op: server credentials cannot be mutated through Axios defaults
  },
  enumerable: true,
  configurable: true,
});

// Request interceptor: authoritative server token resolution, missing token guard,
// baseURL pinning, and upstream host validation.
tmdbApi.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = process.env.TMDB_API_RAT?.trim();
  if (!token) {
    throw new TmdbConfigurationError("TMDB_API_RAT is missing or empty. Server request aborted.");
  }

  // Force baseURL to official TMDB_BASE_URL; reject any attempted override
  if (config.baseURL && config.baseURL !== TMDB_BASE_URL) {
    throw new TmdbHostValidationError(
      `baseURL override rejected: "${config.baseURL}". Only ${TMDB_BASE_URL} is allowed.`
    );
  }
  config.baseURL = TMDB_BASE_URL;

  // Validate the request URL
  validateUpstreamUrl(config.url, config.baseURL);

  // Pin maxRedirects: 0 on every request config
  config.maxRedirects = 0;

  // Authoritatively set Authorization header from process.env; caller writes cannot replace it
  config.headers = config.headers || {};
  config.headers.Authorization = `Bearer ${token}`;

  return config;
});

// Response interceptor: error sanitization and stable error mapping
tmdbApi.interceptors.response.use(
  (response) => response,
  (error) => {
    return Promise.reject(sanitizeAndMapError(error));
  }
);

export default tmdbApi;
