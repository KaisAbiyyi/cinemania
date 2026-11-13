import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { TmdbApiError, isTmdbError, TmdbConfigurationError, TmdbHostValidationError } from "@/services/tmdbApi";

export interface ApiErrorPayload {
  error: string;
  code: string;
  details?: unknown;
}

export class ValidationError extends Error {
  readonly status = 400;
  readonly code = "INVALID_REQUEST";
  readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * CineMania Local Policy Constants for Client Backoff:
 * When upstream TMDB rate limit (429) or service disruption (503) does not provide
 * an explicit upstream 'Retry-After' header, CineMania applies a documented local policy:
 * - 429 (Rate Limit): 60 seconds local cooldown recommendation.
 * - 503 (Service Unavailable): 30 seconds local cooldown recommendation.
 * When an explicit upstream Retry-After header is received from TMDB, that value takes precedence.
 */
export const LOCAL_RATE_LIMIT_RETRY_AFTER_SECONDS = 60;
export const LOCAL_SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS = 30;

/**
 * Normalizes any error thrown during API route execution into a standard JSON response.
 * Maps upstream TMDB errors, validation failures, timeouts, and rate limits to appropriate HTTP statuses:
 * - 400: Input validation failures
 * - 404: Not found
 * - 429: Upstream rate limit exceeded (with optional Retry-After header)
 * - 503: Upstream service unavailable (with optional Retry-After header)
 * - 504: Upstream gateway timeout
 * - 502: Upstream bad gateway / connection / configuration failure
 * - 500: Internal server error
 */
export function handleApiError(error: unknown): NextResponse<ApiErrorPayload> {
  // Input Validation Error (Zod)
  if (error instanceof ZodError) {
    const fieldErrors = error.flatten().fieldErrors;
    const messages = Object.entries(fieldErrors)
      .map(([field, errs]) => `${field}: ${(errs || []).join(", ")}`)
      .join("; ");
    return NextResponse.json(
      {
        error: messages ? `Validation failed: ${messages}` : "Validation failed",
        code: "INVALID_REQUEST",
        details: fieldErrors,
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Custom Application Validation Error
  if (error instanceof ValidationError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // TMDB Upstream Host / Insecure Protocol Validation
  if (error instanceof TmdbHostValidationError) {
    return NextResponse.json(
      {
        error: error.message,
        code: "INVALID_REQUEST",
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  // TMDB Upstream Missing / Invalid Server Configuration
  if (error instanceof TmdbConfigurationError) {
    console.error("[API_ERROR] Server configuration missing:", error.message);
    return NextResponse.json(
      {
        error: "Upstream service configuration error",
        code: "UPSTREAM_CONFIG_ERROR",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  // TMDB Upstream API Error
  if (isTmdbError(error)) {
    const tmdbError = error as TmdbApiError;
    const status = tmdbError.status;

    if (status === 429) {
      const retryAfter =
        tmdbError.retryAfter !== undefined
          ? String(tmdbError.retryAfter)
          : String(LOCAL_RATE_LIMIT_RETRY_AFTER_SECONDS);
      return NextResponse.json(
        {
          error: "Upstream rate limit exceeded",
          code: "RATE_LIMITED",
        },
        {
          status: 429,
          headers: {
            "Retry-After": retryAfter,
            "Cache-Control": "no-store",
          },
        }
      );
    }

    if (status === 503) {
      const retryAfter =
        tmdbError.retryAfter !== undefined
          ? String(tmdbError.retryAfter)
          : String(LOCAL_SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS);
      return NextResponse.json(
        {
          error: "Upstream service temporarily unavailable",
          code: "SERVICE_UNAVAILABLE",
        },
        {
          status: 503,
          headers: {
            "Retry-After": retryAfter,
            "Cache-Control": "no-store",
          },
        }
      );
    }

    if (status === 504 || tmdbError.code === "TMDB_TIMEOUT") {
      return NextResponse.json(
        {
          error: "Upstream service timeout",
          code: "GATEWAY_TIMEOUT",
        },
        { status: 504, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (status === 404) {
      return NextResponse.json(
        {
          error: "Requested resource was not found on TMDB",
          code: "NOT_FOUND",
        },
        { status: 404, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (status === 401 || status === 403) {
      console.error("[API_ERROR] Upstream TMDB authentication/authorization fault:", tmdbError.message);
      return NextResponse.json(
        {
          error: "Upstream service authentication failure",
          code: "UPSTREAM_AUTH_ERROR",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (status >= 500 && status <= 599) {
      return NextResponse.json(
        {
          error: "Upstream service unavailable",
          code: "BAD_GATEWAY",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    if (status === 502 || tmdbError.code === "TMDB_NETWORK_ERROR") {
      return NextResponse.json(
        {
          error: "Unable to reach upstream TMDB service",
          code: "BAD_GATEWAY",
        },
        { status: 502, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      {
        error: "Upstream TMDB request failed",
        code: "BAD_GATEWAY",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Unhandled / Generic Errors
  console.error("[API_ERROR] Unhandled server error:", error);
  return NextResponse.json(
    {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    },
    { status: 500, headers: { "Cache-Control": "no-store" } }
  );
}
