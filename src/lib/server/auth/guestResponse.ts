import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { CapabilityAuthError, type CookieAttributes } from "./guestCapability";
import { RoomRateLimitError } from "./roomRateLimit";
import { isPostgresCapacityError } from "@/lib/server/room/postgresCapacity";
import {
  LOCAL_RATE_LIMIT_RETRY_AFTER_SECONDS,
  LOCAL_SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  ValidationError,
} from "@/lib/api/errorResponse";
import {
  CandidateNotFoundError,
  ImmutableVoteError,
  OperationConflictError,
  ParticipantNotFoundError,
  RoomCapacityError,
  RoomCodeGenerationError,
  RoomExpiredError,
  RoomNotFoundError,
  RoundNotFoundError,
  VoterNotEligibleError,
} from "@/lib/server/room/roomRepository";
import {
  CandidateOutOfOrderError,
  FrozenRosterMissingError,
  MissingMigrationSchemaError,
  VotePayloadError,
} from "@/lib/server/room/votingEngine";
import {
  DeckEmptyError,
  InvalidPresencePayloadError,
  InvalidStateTransitionError,
  RoomCapacityError as StateMachineRoomCapacityError,
  RoomNotExhaustedError,
} from "@/lib/server/room/stateMachine";
import {
  TmdbApiError,
  TmdbConfigurationError,
  TmdbHostValidationError,
  isTmdbError,
} from "@/services/tmdbApi";

export const PRIVATE_NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
};

export function privateJsonResponse<T>(
  body: T,
  status = 200,
  cookie?: CookieAttributes
): NextResponse<T> {
  const response = NextResponse.json(body, {
    status,
    headers: PRIVATE_NO_STORE_HEADERS,
  });

  if (cookie) {
    response.cookies.set({
      name: cookie.name,
      value: cookie.value,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      path: cookie.path,
      secure: cookie.secure,
      maxAge: cookie.maxAge,
    });
  }

  return response;
}

export function handleGuestApiError(err: unknown): NextResponse {
  if (isPostgresCapacityError(err)) {
    console.warn("[CINEMATCH_DB_CAPACITY] Room database connection capacity reached.");
    return NextResponse.json(
      { error: "DATABASE_CAPACITY", message: "Room database is temporarily busy. Please retry." },
      { status: 503, headers: { ...PRIVATE_NO_STORE_HEADERS, "Retry-After": "3" } },
    );
  }
  if (err instanceof RoomRateLimitError) {
    return NextResponse.json(
      { error: "RATE_LIMITED", message: err.message },
      { status: 429, headers: { ...PRIVATE_NO_STORE_HEADERS, "Retry-After": String(err.retryAfter) } },
    );
  }
  if (err instanceof CapabilityAuthError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: err.status, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof RoomNotFoundError) {
    return NextResponse.json(
      { error: "ROOM_NOT_FOUND", message: err.message },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof ParticipantNotFoundError) {
    return NextResponse.json(
      { error: "PARTICIPANT_NOT_FOUND", message: err.message },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof RoundNotFoundError) {
    return NextResponse.json(
      { error: "ROUND_NOT_FOUND", message: err.message },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof CandidateNotFoundError) {
    return NextResponse.json(
      { error: "CANDIDATE_NOT_FOUND", message: err.message },
      { status: 404, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof VotePayloadError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof VoterNotEligibleError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 403, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (
    err instanceof ImmutableVoteError ||
    err instanceof OperationConflictError ||
    err instanceof CandidateOutOfOrderError ||
    err instanceof FrozenRosterMissingError
  ) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 409, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof MissingMigrationSchemaError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof RoomExpiredError) {
    return NextResponse.json(
      { error: "ROOM_EXPIRED", message: err.message },
      { status: 410, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof RoomCodeGenerationError) {
    return NextResponse.json(
      { error: "ROOM_CODE_GENERATION_FAILED", message: err.message },
      { status: 503, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof ValidationError) {
    return NextResponse.json(
      {
        error: "INVALID_DECK_FILTER",
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof DeckEmptyError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 422, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof InvalidPresencePayloadError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof RoomNotExhaustedError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 409, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof RoomCapacityError || err instanceof StateMachineRoomCapacityError) {
    return NextResponse.json(
      { error: err.code, message: err.message },
      { status: 409, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof InvalidStateTransitionError) {
    return NextResponse.json(
      { error: "ROOM_JOIN_CONFLICT", message: err.message },
      { status: 409, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof TmdbHostValidationError) {
    return NextResponse.json(
      { error: "INVALID_REQUEST", message: err.message },
      { status: 400, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (err instanceof TmdbConfigurationError) {
    console.error("[GUEST_API_ERROR] TMDB server configuration is missing.");
    return NextResponse.json(
      {
        error: "UPSTREAM_CONFIG_ERROR",
        message: "Upstream movie catalog configuration is unavailable.",
      },
      { status: 502, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }
  if (isTmdbError(err)) {
    const tmdbErr = err as TmdbApiError;
    if (tmdbErr.status === 429) {
      const retryAfter = String(tmdbErr.retryAfter ?? LOCAL_RATE_LIMIT_RETRY_AFTER_SECONDS);
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: "Upstream movie catalog rate limit exceeded. Please retry shortly.",
        },
        {
          status: 429,
          headers: { ...PRIVATE_NO_STORE_HEADERS, "Retry-After": retryAfter },
        }
      );
    }
    if (tmdbErr.status === 503) {
      const retryAfter = String(
        tmdbErr.retryAfter ?? LOCAL_SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS
      );
      return NextResponse.json(
        {
          error: "SERVICE_UNAVAILABLE",
          message: "Upstream movie catalog temporarily unavailable.",
        },
        {
          status: 503,
          headers: { ...PRIVATE_NO_STORE_HEADERS, "Retry-After": retryAfter },
        }
      );
    }
    if (tmdbErr.status === 504 || tmdbErr.code === "TMDB_TIMEOUT") {
      return NextResponse.json(
        {
          error: "GATEWAY_TIMEOUT",
          message: "Upstream movie catalog timed out. Room stays in lobby; please retry.",
        },
        { status: 504, headers: PRIVATE_NO_STORE_HEADERS }
      );
    }
    return NextResponse.json(
      {
        error: "BAD_GATEWAY",
        message: "Unable to load movie catalog right now. Please retry.",
      },
      { status: 502, headers: PRIVATE_NO_STORE_HEADERS }
    );
  }

  // Sanitized diagnostics only: an allowlisted SQLSTATE, a coarse category and a correlation ID.
  // Never log the raw error, its message, SQL, parameters, cookies, tokens, room or participant IDs.
  const diagnostic = describeUnexpectedFailure(err);
  console.error("[GUEST_API_ERROR] Unexpected guest session failure.", JSON.stringify(diagnostic));
  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "Unexpected guest session failure." },
    { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
  );
}

const DIAGNOSTIC_SQLSTATES = new Set([
  "40P01", // deadlock_detected
  "40001", // serialization_failure
  "55P03", // lock_not_available
  "57014", // query_canceled (statement timeout)
  "25P02", // in_failed_sql_transaction
  "53300", // too_many_connections
  "08000", "08003", "08006", // connection exceptions
  "23505", // unique_violation
  "23514", // check_violation
  "23503", // foreign_key_violation
  "22P02", // invalid_text_representation
]);

const SAFE_CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{0,60}$/;

const INVARIANT_LABELS: ReadonlyArray<readonly [RegExp, string]> = [
  [/Duplicate vote encountered/, "duplicate_vote_in_consensus"],
  [/Frozen round voter roster size/, "frozen_roster_size"],
  [/Cannot start round: movie deck/, "deck_size"],
  [/Realtime publisher configuration/, "publisher_configuration"],
  [/Invalid PostgreSQL schema identifier/, "schema_identifier"],
  [/Outbox events are not strictly ordered/, "outbox_order"],
  // Fixed labels for known pg-pool timeout messages in diagnostic descriptions.
  [/Connection terminated due to connection timeout/, "pool_connection_timeout"],
  [/timeout exceeded when trying to connect/, "pool_checkout_timeout"],
];

/**
 * Walks the error and its `cause` chain (bounded) and returns sanitized facts only: an allowlisted
 * SQLSTATE, a safe class name and a correlation ID. Messages, SQL, parameters and identifiers are never read out.
 */
export function describeUnexpectedFailure(err: unknown): {
  correlationId: string;
  category: "postgres" | "timeout" | "capability" | "unknown";
  sqlstate: string;
  errorClass: string;
  invariant: string;
  causeDepth: number;
} {
  const correlationId = randomUUID();
  let current: unknown = err;
  let sqlstate = "NONE";
  let isPg = false;
  let causeDepth = 0;
  let timeout = false;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; severity?: unknown; message?: unknown; cause?: unknown };
    if (sqlstate === "NONE" && typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      sqlstate = DIAGNOSTIC_SQLSTATES.has(candidate.code) ? candidate.code : "OTHER_SQLSTATE";
    }
    if (typeof candidate.severity === "string") isPg = true;
    if (typeof candidate.message === "string" && /timeout/i.test(candidate.message)) timeout = true;
    if (depth > 0) causeDepth = depth;
    current = candidate.cause;
  }
  // Map known internal invariant messages to fixed labels. The message text itself is never emitted.
  const rawMessage = err instanceof Error ? err.message : "";
  const invariant = INVARIANT_LABELS.find(([pattern]) => pattern.test(rawMessage))?.[1] ?? "unclassified";
  const rawName = err instanceof Error ? err.name : "";
  const errorClass = (err as object | null)?.constructor?.name ?? "";
  const safeClass = SAFE_CLASS_NAME.test(errorClass) ? errorClass : SAFE_CLASS_NAME.test(rawName) ? rawName : "non_error";
  const category = isPg ? "postgres" : timeout ? "timeout" : err instanceof CapabilityAuthError ? "capability" : "unknown";
  return { correlationId, category, sqlstate, errorClass: safeClass, invariant, causeDepth };
}
