import { NextResponse } from "next/server";
import { CapabilityAuthError, type CookieAttributes } from "./guestCapability";
import {
  ParticipantNotFoundError,
  RoomCapacityError,
  RoomCodeGenerationError,
  RoomExpiredError,
  RoomNotFoundError,
} from "@/lib/server/room/roomRepository";
import { InvalidStateTransitionError } from "@/lib/server/room/stateMachine";

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
  if (err instanceof RoomCapacityError) {
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

  return NextResponse.json(
    { error: "INTERNAL_ERROR", message: "Unexpected guest session failure." },
    { status: 500, headers: PRIVATE_NO_STORE_HEADERS }
  );
}
