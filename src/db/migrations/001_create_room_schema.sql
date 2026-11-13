-- CINE-012: Authoritative Room Schema Migration 001 (Forward)
-- Target: PostgreSQL 15+ (Supabase / Managed PostgreSQL)
-- Fully compliant with ADR-003 and security hardening contract

-- 1. Custom Types / Enums
CREATE TYPE room_status AS ENUM (
  'LOBBY',
  'ACTIVE',
  'MATCHED',
  'EXHAUSTED',
  'EXPIRED'
);

CREATE TYPE participant_role AS ENUM (
  'HOST',
  'MEMBER'
);

CREATE TYPE round_status AS ENUM (
  'ACTIVE',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE vote_type AS ENUM (
  'LIKE',
  'SKIP'
);

-- 2. Rooms Table
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(6) NOT NULL,
  status room_status NOT NULL DEFAULT 'LOBBY',
  host_participant_id UUID,
  current_round_id UUID,
  state_version INT NOT NULL DEFAULT 1,
  participant_count INT NOT NULL DEFAULT 1,
  matched_movie_id INT,
  deck_filter JSONB,
  inactivity_ttl_seconds INT NOT NULL DEFAULT 86400,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_room_code_len CHECK (char_length(code) = 6),
  CONSTRAINT chk_participant_count CHECK (participant_count >= 1 AND participant_count <= 5),
  CONSTRAINT chk_ttl_positive CHECK (inactivity_ttl_seconds > 0),
  CONSTRAINT uq_rooms_id_code UNIQUE (id, code)
);

-- 3. Room Participants Table (ADR-003 §4.1: composite PK (room_id, participant_id))
CREATE TABLE room_participants (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL,
  display_name VARCHAR(50) NOT NULL,
  role participant_role NOT NULL DEFAULT 'MEMBER',
  is_connected BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, participant_id),
  CONSTRAINT chk_display_name_not_empty CHECK (char_length(trim(display_name)) > 0)
);

-- P1-B Fix: Column-specific SET NULL prevents PostgreSQL from nulling rooms.id (primary key)
ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_host_participant
  FOREIGN KEY (id, host_participant_id)
  REFERENCES room_participants(room_id, participant_id)
  ON DELETE SET NULL (host_participant_id);

-- 4. Rounds Table (Composite unique (room_id, id) for strict hierarchical FKs)
CREATE TABLE rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  status round_status NOT NULL DEFAULT 'ACTIVE',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_room_round_number UNIQUE (room_id, round_number),
  CONSTRAINT uq_rounds_composite UNIQUE (room_id, id),
  CONSTRAINT chk_round_number_positive CHECK (round_number >= 1)
);

-- Add composite foreign key for current_round_id in rooms (guarantees round belongs to this exact room)
ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_current_round
  FOREIGN KEY (id, current_round_id)
  REFERENCES rounds(room_id, id)
  ON DELETE SET NULL (current_round_id);

-- 5. Candidates Table (The 20-movie deck for a round)
-- P1-C Fix: Composite FK guarantees candidate belongs to a round that belongs to the same room
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id UUID NOT NULL,
  movie_id INT NOT NULL,
  position INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  poster_path VARCHAR(255),
  overview TEXT,
  release_date VARCHAR(20),
  vote_average NUMERIC(3, 1),
  CONSTRAINT fk_candidates_round_room FOREIGN KEY (room_id, round_id)
    REFERENCES rounds(room_id, id) ON DELETE CASCADE,
  CONSTRAINT uq_round_movie UNIQUE (round_id, movie_id),
  CONSTRAINT uq_round_position UNIQUE (round_id, position),
  CONSTRAINT uq_candidates_composite UNIQUE (room_id, round_id, id, movie_id),
  CONSTRAINT chk_candidate_position CHECK (position >= 0 AND position < 20)
);

-- 6. Votes Table (Immutable Votes)
-- P1-C Fix: Composite FKs guarantee participant belongs to room AND candidate belongs to round & room
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL,
  round_id UUID NOT NULL,
  participant_id UUID NOT NULL,
  candidate_id UUID NOT NULL,
  movie_id INT NOT NULL,
  vote vote_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_votes_participant FOREIGN KEY (room_id, participant_id)
    REFERENCES room_participants(room_id, participant_id) ON DELETE CASCADE,
  CONSTRAINT fk_votes_candidate FOREIGN KEY (room_id, round_id, candidate_id, movie_id)
    REFERENCES candidates(room_id, round_id, id, movie_id) ON DELETE CASCADE,
  CONSTRAINT uq_vote_candidate UNIQUE (round_id, participant_id, candidate_id),
  CONSTRAINT uq_vote_movie UNIQUE (round_id, participant_id, movie_id)
);

-- 7. Room Events Table (Transactional Outbox per ADR-003 §4.4)
CREATE TABLE room_events (
  id BIGSERIAL PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  version INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  dispatched BOOLEAN NOT NULL DEFAULT false,
  dispatched_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  poison BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_room_event_version UNIQUE (room_id, version)
);

-- 8. Indexes
CREATE UNIQUE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_status ON rooms(status);
CREATE INDEX idx_rooms_expires_at ON rooms(expires_at);
CREATE INDEX idx_rooms_last_activity ON rooms(last_activity_at);
CREATE INDEX idx_participants_room ON room_participants(room_id);
CREATE INDEX idx_rounds_room ON rounds(room_id);
CREATE INDEX idx_candidates_round ON candidates(round_id, position);
CREATE INDEX idx_votes_round_movie ON votes(round_id, movie_id, vote);
CREATE INDEX idx_votes_participant ON votes(round_id, participant_id);
CREATE INDEX idx_room_events_lookup ON room_events(room_id, version);
CREATE INDEX idx_room_events_pending ON room_events(room_id, version) WHERE NOT dispatched AND NOT poison;

-- 9. Security Definer Functions & Hardening (P1-D Fix)
CREATE OR REPLACE FUNCTION is_current_user_room_participant(target_room_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.room_participants
    WHERE room_id = target_room_id
      AND participant_id = (auth.jwt() ->> 'sub')::uuid
  );
END;
$$;

-- Server-authoritative room resolution function.
-- Hardening: REVOKE from anon and authenticated to prevent unauthenticated/unthrottled
-- room-code guessing oracles via direct PostgREST RPC. Room resolution by code is strictly
-- server-authoritative and executed exclusively through rate-limited Next.js API route
-- handlers using service_role.
CREATE OR REPLACE FUNCTION get_room_by_code(lookup_code VARCHAR(6))
RETURNS TABLE (id UUID, code VARCHAR(6), status room_status, participant_count INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT r.id, r.code, r.status, r.participant_count
  FROM public.rooms r
  WHERE r.code = lookup_code
    AND r.status = 'LOBBY';
END;
$$;

REVOKE ALL ON FUNCTION is_current_user_room_participant(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_current_user_room_participant(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION get_room_by_code(VARCHAR(6)) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_room_by_code(VARCHAR(6)) TO service_role;

-- 10. Row-Level Security (RLS) & Authorization
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_events ENABLE ROW LEVEL SECURITY;

-- Rooms: viewable only by verified room participants with authenticated role
CREATE POLICY rooms_participant_read_policy ON rooms
  FOR SELECT TO authenticated
  USING (is_current_user_room_participant(id));

-- ADR-003 §4.2.1 Least-Privilege Privacy Policy:
-- Participants can ONLY read their own participant record (prevents guest UUID/identity enumeration)
CREATE POLICY participants_self_read_policy ON room_participants
  FOR SELECT TO authenticated
  USING (participant_id = (auth.jwt() ->> 'sub')::uuid);

-- Rounds: viewable only by room participants with authenticated role
CREATE POLICY rounds_read_policy ON rounds
  FOR SELECT TO authenticated
  USING (is_current_user_room_participant(room_id));

-- Candidates: viewable only by room participants with authenticated role
CREATE POLICY candidates_read_policy ON candidates
  FOR SELECT TO authenticated
  USING (is_current_user_room_participant(room_id));

-- 11. Explicit Table Permissions (Fail-Closed Least-Privilege Hardening)
-- Revoke all table privileges from PUBLIC, anon, and authenticated.
-- Prevents retention of preexisting/default ACL privileges (e.g. TRUNCATE, INSERT, UPDATE, DELETE, REFERENCES) on Supabase projects.
REVOKE ALL ON TABLE rooms, room_participants, rounds, candidates, votes, room_events FROM PUBLIC, anon, authenticated;

-- Authenticated guests can only SELECT rooms, room_participants, rounds, candidates subject to RLS
GRANT SELECT ON TABLE rooms, room_participants, rounds, candidates TO authenticated;

-- Server authority (service_role) has full management access across all tables
GRANT ALL ON TABLE rooms, room_participants, rounds, candidates, votes, room_events TO service_role;

-- 12. Explicit Sequence Privileges (BIGSERIAL Outbox Sequence Hardening)
-- Revoke all sequence privileges from PUBLIC, anon, and authenticated.
-- Grant USAGE and SELECT exclusively to service_role for transactional outbox dispatch.
REVOKE ALL ON SEQUENCE room_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE room_events_id_seq TO service_role;
