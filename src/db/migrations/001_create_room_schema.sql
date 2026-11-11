-- CINE-012: Authoritative Room Schema Migration 001 (Forward)
-- Target: PostgreSQL 15+ (Supabase / Managed PostgreSQL)

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
  state_version INT NOT NULL DEFAULT 1,
  participant_count INT NOT NULL DEFAULT 1,
  matched_movie_id INT,
  current_round_id UUID,
  deck_filter JSONB,
  inactivity_ttl_seconds INT NOT NULL DEFAULT 86400,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_room_code_len CHECK (char_length(code) = 6),
  CONSTRAINT chk_participant_count CHECK (participant_count >= 1 AND participant_count <= 5),
  CONSTRAINT chk_ttl_positive CHECK (inactivity_ttl_seconds > 0)
);

-- 3. Room Participants Table
CREATE TABLE room_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  guest_id VARCHAR(64) NOT NULL,
  display_name VARCHAR(30) NOT NULL,
  role participant_role NOT NULL DEFAULT 'MEMBER',
  is_connected BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_room_guest UNIQUE (room_id, guest_id),
  CONSTRAINT chk_display_name_not_empty CHECK (char_length(trim(display_name)) > 0)
);

-- Add foreign key constraint for host_participant_id in rooms
ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_host_participant
  FOREIGN KEY (host_participant_id)
  REFERENCES room_participants(id)
  ON DELETE SET NULL;

-- 4. Rounds Table
CREATE TABLE rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_number INT NOT NULL DEFAULT 1,
  status round_status NOT NULL DEFAULT 'ACTIVE',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT uq_room_round_number UNIQUE (room_id, round_number),
  CONSTRAINT chk_round_number_positive CHECK (round_number >= 1)
);

-- Add foreign key for current_round_id in rooms
ALTER TABLE rooms
  ADD CONSTRAINT fk_rooms_current_round
  FOREIGN KEY (current_round_id)
  REFERENCES rounds(id)
  ON DELETE SET NULL;

-- 5. Candidates Table (The 20-movie deck for a round)
CREATE TABLE candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  movie_id INT NOT NULL,
  position INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  poster_path VARCHAR(255),
  overview TEXT,
  release_date VARCHAR(20),
  vote_average NUMERIC(3, 1),
  CONSTRAINT uq_round_movie UNIQUE (round_id, movie_id),
  CONSTRAINT uq_round_position UNIQUE (round_id, position),
  CONSTRAINT chk_candidate_position CHECK (position >= 0 AND position < 20)
);

-- 6. Votes Table (Immutable Votes)
CREATE TABLE votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES room_participants(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  movie_id INT NOT NULL,
  vote vote_type NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_vote_candidate UNIQUE (round_id, participant_id, candidate_id),
  CONSTRAINT uq_vote_movie UNIQUE (round_id, participant_id, movie_id)
);

-- 7. Room Events Table (Transactional Outbox)
CREATE TABLE room_events (
  id BIGSERIAL PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  version INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
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
