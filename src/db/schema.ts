/**
 * CINE-012: Authoritative Database Schema Definitions and Types
 * Defines Room, Participant, Round, Candidate, Vote, Event with statuses:
 * LOBBY, ACTIVE, MATCHED, EXHAUSTED, EXPIRED.
 * 
 * Fully aligned with ADR-003 (Realtime & Persistence Architecture).
 */

export type RoomStatus = "LOBBY" | "ACTIVE" | "MATCHED" | "EXHAUSTED" | "EXPIRED";
export type ParticipantRole = "HOST" | "MEMBER";
export type RoundStatus = "ACTIVE" | "COMPLETED" | "CANCELLED";
export type VoteType = "LIKE" | "SKIP";

export type RoomEventType =
  | "ROOM_CREATED"
  | "PARTICIPANT_JOINED"
  | "PARTICIPANT_LEFT"
  | "HOST_TRANSFERRED"
  | "ROSTER_FROZEN"
  | "ROUND_STARTED"
  | "VOTE_RECORDED"
  | "MATCH_ANNOUNCED"
  | "DECK_EXHAUSTED"
  | "ROOM_EXPIRED";

export interface Room {
  id: string; // UUID
  code: string; // 6-character room code
  status: RoomStatus;
  host_participant_id: string | null;
  state_version: number;
  participant_count: number;
  matched_movie_id: number | null;
  current_round_id: string | null;
  deck_filter: Record<string, unknown> | null;
  inactivity_ttl_seconds: number;
  last_activity_at: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface RoomParticipant {
  room_id: string; // UUID
  participant_id: string; // UUID (matches guest JWT sub per ADR-003)
  display_name: string;
  role: ParticipantRole;
  is_connected: boolean;
  joined_at: string;
  last_seen_at: string;
}

export interface Round {
  id: string; // UUID
  room_id: string;
  round_number: number;
  status: RoundStatus;
  started_at: string;
  completed_at: string | null;
}

export interface RoundParticipant {
  room_id: string;
  round_id: string;
  participant_id: string;
  frozen_role: ParticipantRole;
  joined_at: string;
  frozen_at: string;
}

export interface Candidate {
  id: string; // UUID
  round_id: string;
  room_id: string;
  movie_id: number;
  position: number; // 0..19
  title: string;
  poster_path: string | null;
  overview: string | null;
  release_date: string | null;
  vote_average: number | null;
}

export interface Vote {
  id: string; // UUID
  room_id: string;
  round_id: string;
  participant_id: string;
  candidate_id: string;
  movie_id: number;
  vote: VoteType;
  created_at: string;
}

export interface RoomEvent {
  id: number | string;
  room_id: string;
  version: number;
  event_type: RoomEventType;
  payload: Record<string, unknown>;
  dispatched: boolean;
  dispatched_at: string | null;
  retry_count: number;
  poison: boolean;
  created_at: string;
}

export const ROOM_STATUSES: readonly RoomStatus[] = [
  "LOBBY",
  "ACTIVE",
  "MATCHED",
  "EXHAUSTED",
  "EXPIRED",
] as const;

export const PARTICIPANT_ROLES: readonly ParticipantRole[] = ["HOST", "MEMBER"] as const;
export const ROUND_STATUSES: readonly RoundStatus[] = ["ACTIVE", "COMPLETED", "CANCELLED"] as const;
export const VOTE_TYPES: readonly VoteType[] = ["LIKE", "SKIP"] as const;

export const DEFAULT_INACTIVITY_TTL_SECONDS = 86400; // 24 hours
export const MAX_PARTICIPANTS = 5;
export const MIN_PARTICIPANTS = 2;
export const DECK_SIZE = 20;
