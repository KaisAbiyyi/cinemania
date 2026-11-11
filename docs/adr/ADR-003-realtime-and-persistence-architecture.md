# ADR-003: Realtime and Persistence Architecture for CineMatch Rooms

- **Status:** Proposed (Under Review)
- **Deciders:** CineMatch Architecture Team (Owner Approval Pending)
- **Date:** 2026-11-09 (Revised 2026-11-10, Revision 6)
- **Task References:** [CINE-011](https://github.com/KaisAbiyyi/cinemania/issues/13), [CINE-012](https://github.com/KaisAbiyyi/cinemania/issues/14), [CINE-013](https://github.com/KaisAbiyyi/cinemania/issues/15), [CINE-014](https://github.com/KaisAbiyyi/cinemania/issues/16), [CINE-017](https://github.com/KaisAbiyyi/cinemania/issues/19), [CINE-018](https://github.com/KaisAbiyyi/cinemania/issues/20), [CINE-019](https://github.com/KaisAbiyyi/cinemania/issues/21), [CINE-020](https://github.com/KaisAbiyyi/cinemania/issues/22)
- **Predecessor Dependencies:** [CINE-001 (Audit)](https://github.com/KaisAbiyyi/cinemania/issues/3), [CINE-004 (CI)](https://github.com/KaisAbiyyi/cinemania/issues/6), [ADR-002 (Product Contract)](https://github.com/KaisAbiyyi/cinemania/pull/37)

---

## 1. Context and Problem Statement

CineMatch is a collaborative movie matching decision platform for small groups (2 to 5 participants) running on Next.js 16 (App Router) deployed to Vercel/serverless cloud infrastructure.

In serverless execution environments, compute functions are **stateless, ephemeral, and horizontally scaled across independent worker processes**. Two or more room participants submitting votes or awaiting room events will almost certainly connect to different serverless instances. Consequently:
1. **Absence of Native Long-Lived Sockets:** Serverless runtimes cannot hold persistent in-memory room state or terminate bi-directional stateful WebSockets directly without incurring connection termination, state fragmentation, or prohibitive function execution duration billing.
2. **Atomic Voting Consensus & Phantom Reads:** Votes are immutable and require unanimous agreement across the frozen roster. Concurrent votes submitted by multiple participants at the same millisecond under standard Read Committed isolation can lead to phantom reads: if Transaction 1 and Transaction 2 both count votes before either commits, both can observe incomplete totals and fail to transition the room to `MATCHED`.
3. **Session Reconnection & Event Gaps:** Participants on mobile devices experience transient network drops, lock-screen suspension, and browser reloads. Subscribing to an ephemeral broadcast channel after fetching a snapshot introduces a race window where events occurring between the snapshot read and WebSocket subscription establishment are lost.
4. **Security, Zero Leaks & Secret Voting:** Database connection strings, service credentials, and TMDB tokens must never leak to the client browser. Individual participant voting decisions (`LIKE` vs `SKIP`) must remain strictly confidential and never be disclosed via real-time broadcasts or replay feeds to prevent peer bias (CINE-020 requirement). Only the final unanimous match may reveal the winning title.

---

## 2. Decision Drivers

- **Serverless & Multi-Instance Compatibility:** Architecture must operate natively on multi-instance serverless deployments without requiring self-hosted stateful server processes.
- **Strict State Authority & Concurrency Control:** State mutations (roster freeze, vote recording, unanimous match transitions) must be atomic and server-authoritative, serialized by database row-level locking (`SELECT ... FOR UPDATE`) and guarded transitions.
- **Vote Confidentiality & Anti-Bias (CINE-020):** Voting choices are secret until unanimous match; broadcast events and replay feeds must never expose individual members' LIKE/SKIP choices.
- **Authoritative Channel Protection:** Clients must be strictly read-only listeners on authoritative state channels; clients cannot forge or spoof server state events.
- **Low-Latency Event Fan-out:** Room event propagation (lobby joins, votes cast, match found) should reach room participants in <100ms under normal cloud network conditions.
- **Cost & Free Tier Limits:** Must provide a sustainable free tier for development/MVP and predictable scale-to-zero cost.
- **Resilient Reconnection:** Version/sequence-based event ordering and transactional outbox persistence to prevent event gap races.

---

## 3. Comparative Architecture Analysis

| Evaluation Dimension | Candidate A: Managed Postgres + Realtime (Supabase Proposal) | Candidate B: Serverless Postgres (Neon) + SSE / Polling | Candidate C: Stateful Edge WebSockets (PartyKit / Durable Objects) | Candidate D: Redis Pub/Sub (Upstash) + SSE |
| :--- | :--- | :--- | :--- | :--- |
| **Persistence Engine** | Managed PostgreSQL (ACID, relational schema, JSONB, row-level locks) | Serverless PostgreSQL (Neon branching, ACID) | Ephemeral in-memory actor state + SQLite/Blob persistence | Key-value / Hashes (in-memory Redis data structures) |
| **Realtime Event Transport** | Managed WebSockets (Realtime Broadcast & WAL replication) | Server-Sent Events (SSE) or short HTTP polling | Stateful bi-directional WebSockets terminating on edge actor | SSE or long polling via serverless functions |
| **Vercel / Serverless Parity** | **High compatibility.** Clients connect directly to managed Realtime endpoint; serverless functions mutate DB over connection pooler. | **Limited.** Vercel function duration limits (15s–300s) make long-lived SSE connections fragile and costly. | **External.** Requires deploying and managing separate edge infrastructure outside Vercel. | **Moderate.** Requires maintaining connection pools or HTTP polling proxies. |
| **State Authority & Concurrency** | **Strict.** PostgreSQL row-level locks (`SELECT ... FOR UPDATE`) and guarded `UPDATE rooms SET status = 'MATCHED'`. | **Strict.** Full PostgreSQL transaction isolation. | **Actor-isolated.** Single-threaded execution per room actor prevents internal race conditions. | **Conditional.** Redis Lua scripts provide atomic script execution, but lack relational constraints. |
| **Reconnection & Catch-Up** | Monotonic `state_version` + Transactional Outbox table (`room_events`) queryable via REST. | Snapshot query + SSE `Last-Event-ID` or manual polling. | Client re-attaches to durable actor; in-memory replay buffer. | Redis Stream `XREAD` with offset tracking. |
| **Cost & Free Tier Limits** | 500 MB DB, 200 concurrent Realtime connections, 2M Realtime messages/mo (MVP assumptions; usage limits apply). | Generous storage and compute hours; no built-in WebSocket broker. | Free tier for hobby; per-request / per-room actor charges at scale. | 10k commands/day free; $0.20 per 100k commands thereafter. |

---

## 4. Decision Outcome

**Proposed Architecture:** **Candidate A — Managed PostgreSQL with Supabase Realtime Engine**.

### 4.1 State Machine Authority & Concurrency Model
1. **Server as Single Authority:** Client UI components are purely reactive projections. The server holds exclusive authority over:
   - Room lifecycle: `LOBBY -> VOTING -> MATCHED | NO_MATCH`.
   - Deck assignment: Exactly 20 movies frozen at round start.
   - Vote immutability: Exactly 1 vote per member per movie.
   - Matching rule: Unanimous consensus across all members in the frozen roster.

2. **Row-Level Locking Concurrency Control:**
   When concurrent swiping occurs, incoming votes execute within a PostgreSQL transaction with an explicit row lock:
   ```sql
   -- Acquire exclusive row lock on the room row to serialize concurrent vote processing
   SELECT id, status, participant_count, state_version 
   FROM rooms 
   WHERE id = $1 
   FOR UPDATE;
   ```
3. **Guarded State Transition:**
   - Votes are recorded in `votes` table (`ON CONFLICT (room_id, participant_id, movie_id) DO NOTHING`).
   - If vote is `LIKE`, count total `LIKE` votes for this `movieId` in the locked room:
     ```sql
     SELECT COUNT(*) FROM votes WHERE room_id = $1 AND movie_id = $2 AND vote = 'LIKE';
     ```
   - If `COUNT(*) == participant_count`, execute guarded transition:
     ```sql
     UPDATE rooms 
     SET status = 'MATCHED', 
         matched_movie_id = $2, 
         state_version = state_version + 1,
         updated_at = NOW()
     WHERE id = $1 AND status = 'VOTING'
     RETURNING *;
     ```
   - Exactly one concurrent transaction succeeds in transitioning the status; other concurrent transactions read the committed `MATCHED` status and return the match immediately without duplicate transitions.

4. **Transactional Outbox for Event Ordering & Vote Confidentiality:**
   - In the same database transaction, insert a public event into `room_events`:
     ```sql
     INSERT INTO room_events (room_id, version, event_type, payload, created_at)
     VALUES ($1, $new_version, $event_type, $payload, NOW());
     ```
   - **Secret Vote Guarantee (CINE-020):** For event `vote_recorded`, the broadcast payload is strictly `{ "participantId": "<uuid>" }`. Individual vote choices (`voteType: "LIKE" | "SKIP"`) and movie IDs are **NEVER** placed into public broadcast events or shared outbox replay feeds. They remain confidential inside the server's private `votes` table.
   - Only when unanimous agreement occurs is `match_announced` broadcast with `{ "movieId": 550, "unanimousCount": 5 }`.
   - Events have strictly ordered, monotonic `version` integers.

### 4.2 Room Access Isolation, Channel Authorization & Publisher Trust Model
1. **Cryptographically Signed Realtime Capability Token:**
   - When a guest joins or re-authenticates, the server issues a signed, short-lived HMAC-SHA256 JWT scoped strictly to that room:
     `{ sub: participant_id, room_id: room_id, role: 'authenticated', iat: <seconds>, exp: <seconds> }`.
   - Token timestamps conform strictly to RFC 7519 `NumericDate` (integer seconds since Unix epoch).
   - Verifiers enforce `iat <= nowSeconds + 30` (rejecting future-issued tokens), maximum token TTL of 24 hours (`exp - iat <= 86400`), algorithm whitelist (`HS256` only), and roster membership validation.

2. **Fail-Closed Supabase Realtime Private Channels Deployment Settings:**
   To guarantee strict private-only channel enforcement and prevent unauthorized or unauthenticated eavesdropping:
   - **Project Setting (Fail-Closed):** The project-level Realtime setting **"Allow public access" MUST BE DISABLED** in Supabase Project Settings -> Realtime. When public access is disabled, channels reject anonymous connections by default.
   - **Client Channel Configuration:** Clients MUST subscribe using explicit private channel configuration:
     ```typescript
     // Client subscription pattern (Next.js client)
     const channel = supabase.channel(`room:${roomId}`, {
       config: { private: true },
     });
     ```
   - **Canonical Topic Standard:** Realtime channel topic is strictly and exclusively formatted as `room:${room_id}` where `room_id` is the opaque room UUIDv4 (never the user-facing 6-character room code).

3. **Row-Level Security on `realtime.messages` (Listen-Only Subscription Policy):**
   Supabase Realtime Authorization evaluates Row-Level Security policies on `realtime.messages` using `realtime.topic()`:
   ```sql
   -- Authorize private channel subscription (listen-only)
   CREATE POLICY "Authorize room channel subscription"
   ON realtime.messages
   FOR SELECT
   TO authenticated
   USING (
     -- Compare channel topic to authorized room ID claim in JWT
     realtime.topic() = ('room:' || (auth.jwt() ->> 'room_id'))
     -- Authorize only registered participants via safe non-enumerating helper
     AND public.is_current_user_room_participant(
       (auth.jwt() ->> 'room_id')::uuid
     )
   );
   ```

4. **Strict Denial of Client-Side Broadcast (Fail-Closed Restrictive Policy):**
   - Clients are **strictly prohibited from publishing directly to `room:${room_id}`**. There is NO client broadcast permission.
   - An explicit fail-closed **RESTRICTIVE** policy is attached to `realtime.messages`. In PostgreSQL, restrictive policies are combined with AND across all policies, guaranteeing that client publications are rejected even if another permissive INSERT policy exists:
     ```sql
     -- Fail-closed restrictive policy denying client-originated broadcast on room channels
     CREATE POLICY "Deny client publication on room channels"
     ON realtime.messages
     AS RESTRICTIVE
     FOR INSERT
     TO authenticated
     WITH CHECK (
       -- Restrictive check: unconditional denial for room:* topics
       CASE
         WHEN realtime.topic() LIKE 'room:%' THEN false
         ELSE true
       END
     );
     ```
   - Authoritative state events (`roster_frozen`, `vote_recorded`, `match_announced`) are published **exclusively by backend serverless route handlers** using the server-side modern secret key (`SUPABASE_SECRET_KEY`), which bypasses client RLS.
   - Any client attempt to forge or spoof a broadcast on the authoritative room channel is rejected with `403 Forbidden`.
   - Client UI components treat WebSocket events as reactive notifications and reconcile against the authoritative snapshot via HTTP `GET /api/room/[code]`.
   - Negative E2E controls planned for CINE-012/CINE-018:
     - `TEST_UNAUTHORIZED_PUBLIC_JOIN`: Unauthenticated client receives connection denial.
     - `TEST_CROSS_ROOM_JOIN`: Valid token for Room A receives `403 Forbidden` attempting to join Room B.
     - `TEST_ROGUE_CLIENT_BROADCAST`: Authenticated participant attempting `channel.send()` receives rejection.
     - `TEST_AUTHENTICATED_MEMBER_SELECT`: Valid participant successfully receives server-originated broadcasts.

### 4.2.1 Guest Membership Lookup RLS & Security Definer Pattern (CINE-013 & CINE-018)
In CineMatch, users participate as anonymous guests without registering email/password accounts or having rows in Supabase Auth's `auth.users` table:
1. **Guest Identity Generation:** The server generates a cryptographic UUIDv4 `participant_id` for each guest, sealed in an `HttpOnly, Secure, SameSite=Lax` cookie (`cinematch_guest_token`).
2. **Room Membership Table Schema:**
   ```sql
   CREATE TABLE public.room_participants (
     room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
     participant_id UUID NOT NULL,
     role TEXT NOT NULL DEFAULT 'MEMBER' CHECK (role IN ('HOST', 'MEMBER')),
     joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     PRIMARY KEY (room_id, participant_id)
   );

   -- Least-privilege RLS: participants can ONLY read their own membership record
   ALTER TABLE public.room_participants ENABLE ROW LEVEL SECURITY;

   CREATE POLICY "Participants can only read own room participant records"
     ON public.room_participants
     FOR SELECT
     TO authenticated
     USING (participant_id = (auth.jwt() ->> 'sub')::uuid);
   ```
3. **Safe Non-Enumerating Membership Helper (SECURITY DEFINER):**
   To allow Realtime RLS to verify room membership without granting blanket `SELECT` on all participants (preventing user enumeration or cross-room scraping), a scoped `SECURITY DEFINER` function derives user identity **strictly from the caller's verified JWT (`auth.jwt() ->> 'sub'`)**:
   ```sql
   -- Safe non-enumerating membership helper: caller cannot supply arbitrary target_user_id
   CREATE OR REPLACE FUNCTION public.is_current_user_room_participant(target_room_id uuid)
   RETURNS boolean
   LANGUAGE sql
   STABLE
   SECURITY DEFINER
   SET search_path = public, pg_temp
   AS $$
     SELECT EXISTS (
       SELECT 1
       FROM public.room_participants
       WHERE room_id = target_room_id
         AND participant_id = (auth.jwt() ->> 'sub')::uuid
     );
   $$;

   -- Lock down function execution permissions
   REVOKE ALL ON FUNCTION public.is_current_user_room_participant(uuid) FROM public;
   GRANT EXECUTE ON FUNCTION public.is_current_user_room_participant(uuid) TO authenticated;
   GRANT EXECUTE ON FUNCTION public.is_current_user_room_participant(uuid) TO service_role;
   ```
4. **Realtime Capability JWT Claims (RFC 7519 Compliant):** To connect to Supabase Realtime private channels, the server issues a scoped JWT signed with the project's Supabase JWT secret using algorithm `HS256`:
   ```json
   {
     "sub": "<participant_id_uuid>",
     "room_id": "<room_id_uuid>",
     "role": "authenticated",
     "iat": 1700000000,
     "exp": 1700003600
   }
   ```
   Note: `iat` and `exp` are integer seconds (RFC 7519 `NumericDate`), strictly bounded (max 24h lifetime) and validated.
5. **Outstanding Live Cloud Qualification Gate:** While this policy and token contract are simulated and validated locally in `tests/integration/realtime-persistence-poc.test.ts`, live configuration and end-to-end testing against a real Supabase project (private channels extension, live RLS evaluation, WebSocket token handshake) remain **BLOCKED and OUTSTANDING** until Supabase infrastructure is provisioned in CINE-012/CINE-018.

### 4.3 Subscribe-First & Version-Reconciled Reconnect Protocol
To prevent the reconnect race condition (where events are lost between snapshot retrieval and socket connection):
1. **Subscribe First:** The reconnecting client establishes its WebSocket connection and subscribes to the canonical private channel topic `room:${room_id}` (where `room_id` is the opaque UUID obtained from session state or prior join, never the shareable 6-character room code), buffering incoming real-time events locally.
2. **Fetch Snapshot:** The client requests the authoritative snapshot via HTTP `GET /api/room/[code]`, which returns the current room state along with its `id` (the opaque UUID), its `state_version`, and only the caller's own votes (`userVotes`).
3. **Reconcile Buffer:**
   - The client hydrates UI state from the snapshot.
   - The client filters buffered events: any event with `version <= snapshot.state_version` is discarded as already incorporated.
   - Any event with `version > snapshot.state_version` is applied in sequential order.
   - If an event version gap is detected (e.g. buffered events skip from version 5 to 7), the client triggers an immediate catch-up query:
     `GET /api/room/[code]/events?since=${snapshot.state_version}`.

```mermaid
sequenceDiagram
    autonumber
    actor Player as Reconnecting Player
    participant Server as Next.js API Route (Serverless)
    participant RT as Supabase Realtime Broker
    participant DB as PostgreSQL (State Authority)

    Note over Player: Network drop recovered
    Player->>RT: 1. Subscribe to canonical channel "room:<room_uuid>" (Buffer incoming)
    RT-->>Player: Subscription Confirmed
    Player->>Server: 2. GET /api/room/ABC123 (Auth Cookie)
    Server->>DB: Query Room Snapshot & state_version
    DB-->>Server: Snapshot { id: '<room_uuid>', status: 'VOTING', state_version: 5, deck, userVotes }
    Server-->>Player: Return Snapshot (id: '<room_uuid>', version: 5)
    Note over Player: 3. Hydrate UI with snapshot.<br/>Replay buffered events where version > 5.<br/>Discard events where version <= 5.
```

### 4.4 Transactional Outbox Dispatch, Delivery Guarantees & Crash Recovery (Assigned to CINE-018)
In serverless execution environments, compute functions can terminate, time out, or lose network connectivity after a database transaction commits but before WebSocket publication succeeds. To guarantee eventual delivery without corrupting room state:
1. **Atomic Outbox Persistence:** Every state mutation commits its updated room record and appends a corresponding event to `public.room_events` in the **same atomic database transaction**:
   ```sql
   CREATE TABLE public.room_events (
     id BIGSERIAL PRIMARY KEY,
     room_id UUID NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
     version INT NOT NULL,
     event_type TEXT NOT NULL,
     payload JSONB NOT NULL,
     dispatched BOOLEAN NOT NULL DEFAULT FALSE,
     poison BOOLEAN NOT NULL DEFAULT FALSE,
     retry_count INT NOT NULL DEFAULT 0,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   );
   CREATE INDEX idx_room_events_pending ON public.room_events (room_id, version) WHERE NOT dispatched AND NOT poison;
   ```
2. **Immediate Post-Commit Dispatch:** The executing serverless route handler attempts immediate synchronous broadcast to `room:${room_id}` via Supabase Realtime using `SUPABASE_SECRET_KEY` and flags `dispatched = TRUE`.
3. **Crash Recovery & Reconciliation Sweeper (CINE-018 Acceptance):**
   - If the serverless worker crashes after DB commit but before broadcast:
     - The next incoming room request (or a lightweight scheduled sweeper) executes:
       `SELECT * FROM public.room_events WHERE room_id = $1 AND NOT dispatched AND NOT poison ORDER BY version ASC FOR UPDATE SKIP LOCKED;`
     - Any un-dispatched events are published to `room:${room_id}` in strict monotonic version order, and updated to `dispatched = TRUE`.
   - **Idempotency & Poison-Event Handling:**
     - Realtime clients deduplicate events via monotonic `version` tracking: any event with `version <= lastSeenVersion` is discarded.
     - Events exceeding retry limits (e.g. 3 failed attempts) are quarantined with `poison = TRUE` and logged for operational alerting without permanently blocking room progression.

---

## 5. Consequences & Tradeoffs

### Positive
- **Serverless Alignment:** Next.js API routes scale to zero on Vercel; compute does not hold stateful socket connections in memory.
- **Vote Privacy Guarantee:** Broadcast events and outbox replay omit individual voting decisions (`LIKE`/`SKIP`), preventing peer bias and satisfying CINE-020.
- **Publisher Integrity:** Clients have listen-only access on authoritative topics; clients cannot forge state transitions or match events.
- **Concurrency Safety:** Explicit PostgreSQL `SELECT ... FOR UPDATE` row locks guarantee serialization of concurrent votes across distinct serverless instances, eliminating double-matches and phantom reads.
- **Durability & Catch-Up:** Monotonic `state_version` and transactional outbox eliminate the snapshot-then-subscribe race window.
- **Tenant Isolation:** Private channels authorized via signed room-scoped JWTs ensure zero cross-room event leakage.

### Negative / Tradeoffs
- External managed service dependency (Supabase / PostgreSQL connection pooler).
- Free tier limit of 200 concurrent Realtime connections provides capacity for ~40 simultaneous 5-player rooms during MVP. Growth beyond this threshold requires upgrading to paid usage tiers.

### Concurrency Verification Scope & Cloud Deployment Caveat
- **Relational Concurrency Model vs Production Cloud Behavior:** The local POC in `tests/integration/realtime-persistence-poc.test.ts` validates relational ACID transaction serialization, exclusive transaction locking (`BEGIN IMMEDIATE`), and single guarded transitions across isolated worker threads with deterministic write contention, two-way acknowledgment handshakes, and lock waiting. However, SQLite file locking differs from PostgreSQL row-level locks (`SELECT ... FOR UPDATE`), and worker threads do not simulate multi-process serverless network latency, connection pooling (PgBouncer), or failover.
- Therefore, the relational model serves as algorithmic and architectural proof of concept; full multi-instance PostgreSQL row-level locking and Supabase Realtime verification remain **OUTSTANDING** and must be qualified on live cloud infrastructure during CINE-012 (PostgreSQL schema & migrations) and CINE-018 (Realtime broadcaster).

---

## 6. Implementation Scope Fence & Owner Milestone Gate
- **Deliverables Completed in CINE-011 (PR #40):**
  1. Complete architectural decision record (ADR-003) selecting Supabase Realtime + PostgreSQL, defining state authority, capability token claims, RLS policies, reconnect protocols, and outbox reliability contracts.
  2. Local multi-worker SQLite algorithmic model (`tests/integration/realtime-persistence-poc.test.ts`) validating serializable consensus, deterministic two-way handshake write contention (`BEGIN IMMEDIATE`), lock waiting, decoupled subscriber delivery, crash-between-commit-and-publish recovery, and versioned reconciliation.
- **Formally Fenced / Blocked Cloud Infrastructure (Deferred to CINE-012/CINE-018):**
  - Live cloud multi-instance PostgreSQL row locks (`SELECT ... FOR UPDATE`), live cloud Supabase Realtime WebSocket private channel connections, cloud JWT handshake, and measured cloud network latency are formally **BLOCKED and NOT RUN** on this task pending the owner's explicit milestone decision and infrastructure provisioning in CINE-012 (Data Layer) and CINE-018 (Realtime Broker).

---

## 7. Verification & Acceptance Status

- **Cryptographic Capability Token Signing & Tamper Verification:** Verified in `tests/integration/realtime-persistence-poc.test.ts` (RFC 7519 NumericDate seconds, HMAC-SHA256, timingSafeEqual, expiration, future `iat` rejection, max 24h lifetime bound, roster membership, alg header validation).
- **Vote Confidentiality Guarantee (CINE-020):** Verified in `tests/integration/realtime-persistence-poc.test.ts` (live broadcasts and event replay omit participant LIKE/SKIP choices).
- **Authoritative Publisher Trust Model:** Verified in `tests/integration/realtime-persistence-poc.test.ts` (clients denied publication on authoritative channel; server-only broadcast).
- **Non-Enumerating Least-Privilege RLS:** Verified via `public.is_current_user_room_participant` architecture and simulated multi-user topic authorization.
- **Relational Multi-Worker Concurrency & ACID Isolation:** Verified via Node 24 `node:sqlite` WAL mode across two isolated worker threads with deterministic two-way handshake contention and lock waiting (SQLite algorithmic model only).
- **Subscribe-First Reconnect & Exact Monotonic Outbox Replay:** Verified with deterministic version recovery `[4, 5, 6]` (model only).
- **Crash-Between-Commit-and-Publish Recovery:** Verified via outbox persistence and reconciliation model.
- **Local Latency Percentiles:** Verified in local asynchronous mock (model only, not deployed cloud latency).
- **External Multi-Instance PostgreSQL & Live Supabase Cloud Infrastructure:** Explicitly marked **OUTSTANDING & BLOCKED** pending cloud infrastructure provisioning in CINE-012/CINE-018.
