import { NextResponse } from "next/server";
import { CapabilityAuthError, type CookieAttributes } from "./guestCapability";
import {
  LOCAL_RATE_LIMIT_RETRY_AFTER_SECONDS,
  LOCAL_SERVICE_UNAVAILABLE_RETRY_AFTER_SECONDS,
  ValidationError,
} from "@/lib/api/errorResponse";
import {
  ParticipantNotFoundError,
  RoomCapacityError,
  RoomCodeGenerationError,
  RoomExpiredError,
  RoomNotFoundError,
} from "@/lib/server/room/roomRepository";
import {
  DeckEmptyError,
  InvalidStateTransitionError,
  RoomCapacityError as StateMachineRoomCapacityError,
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
    console.error("[GUEST_API_ERROR] TMDB server configuration missing:", err.message);
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

  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "Unexpected guest session failure." },
    { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
  );
}
