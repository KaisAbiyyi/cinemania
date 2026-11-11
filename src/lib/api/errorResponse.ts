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
 * Normalizes any error thrown during API route execution into a standard JSON response.
 * Maps upstream TMDB errors, validation failures, timeouts, and rate limits to appropriate HTTP statuses.
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
      { status: 400 }
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
      { status: 400 }
    );
  }

  // TMDB Upstream Host / Insecure Protocol Validation
  if (error instanceof TmdbHostValidationError) {
    return NextResponse.json(
      {
        error: error.message,
        code: "INVALID_REQUEST",
      },
      { status: 400 }
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
      { status: 502 }
    );
  }

  // TMDB Upstream API Error
  if (isTmdbError(error)) {
    const tmdbError = error as TmdbApiError;
    const status = tmdbError.status;

    if (status === 429) {
      return NextResponse.json(
        {
          error: "Upstream rate limit exceeded",
          code: "RATE_LIMITED",
        },
        { status: 429 }
      );
    }

    if (status === 504 || tmdbError.code === "TMDB_TIMEOUT") {
      return NextResponse.json(
        {
          error: "Upstream service timeout",
          code: "GATEWAY_TIMEOUT",
        },
        { status: 504 }
      );
    }

    if (status === 404) {
      return NextResponse.json(
        {
          error: "Requested resource was not found on TMDB",
          code: "NOT_FOUND",
        },
        { status: 404 }
      );
    }

    if (status === 401 || status === 403) {
      console.error("[API_ERROR] Upstream TMDB authentication/authorization fault:", tmdbError.message);
      return NextResponse.json(
        {
          error: "Upstream service authentication failure",
          code: "UPSTREAM_AUTH_ERROR",
        },
        { status: 502 }
      );
    }

    if (status >= 500 && status <= 599) {
      return NextResponse.json(
        {
          error: "Upstream service unavailable",
          code: "BAD_GATEWAY",
        },
        { status: 502 }
      );
    }

    if (status === 502 || tmdbError.code === "TMDB_NETWORK_ERROR") {
      return NextResponse.json(
        {
          error: "Unable to reach upstream TMDB service",
          code: "BAD_GATEWAY",
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      {
        error: "Upstream TMDB request failed",
        code: "BAD_GATEWAY",
      },
      { status: 502 }
    );
  }

  // Unhandled / Generic Errors
  console.error("[API_ERROR] Unhandled server error:", error);
  return NextResponse.json(
    {
      error: "Internal server error",
      code: "INTERNAL_ERROR",
    },
    { status: 500 }
  );
}
