# ADR-003: Realtime and Persistence Architecture for CineMatch Rooms

- **Status:** Accepted
- **Deciders:** CineMatch Architecture Team & Repository Owner
- **Date:** 2026-11-09
- **Task References:** [CINE-011](https://github.com/KaisAbiyyi/cinemania/issues/13), [CINE-012](https://github.com/KaisAbiyyi/cinemania/issues/14), [CINE-013](https://github.com/KaisAbiyyi/cinemania/issues/15), [CINE-014](https://github.com/KaisAbiyyi/cinemania/issues/16), [CINE-017](https://github.com/KaisAbiyyi/cinemania/issues/19), [CINE-018](https://github.com/KaisAbiyyi/cinemania/issues/20), [CINE-019](https://github.com/KaisAbiyyi/cinemania/issues/21)
- **Predecessor Dependencies:** [CINE-001 (Audit)](https://github.com/KaisAbiyyi/cinemania/issues/3), [CINE-004 (CI)](https://github.com/KaisAbiyyi/cinemania/issues/6), [ADR-002 (Product Contract)](https://github.com/KaisAbiyyi/cinemania/pull/37)

---

## 1. Context and Problem Statement

CineMatch is a collaborative movie matching experience for small groups (2 to 5 participants) running on Next.js 16 (App Router) deployed to Vercel/serverless cloud infrastructure.

In serverless execution environments, compute functions are **stateless, ephemeral, and horizontally scaled across independent worker processes**. Two or more room participants submitting votes or awaiting room events will almost certainly connect to different serverless instances. Furthermore:
1. **No In-Memory Sockets:** Serverless runtimes cannot hold long-lived in-memory state or terminate bi-directional stateful WebSockets directly without incurring connection termination, state fragmentation, or excessive billing execution duration.
2. **Atomic Voting Consensus:** Votes are immutable and require unanimous agreement across the frozen roster. Concurrent votes submitted by multiple participants at the same millisecond must not create split-brain states, double-matched movies, or race conditions.
3. **Session Reconnection:** Participants on mobile devices experience transient network drops, lock-screen suspension, and browser reloads. The system must support immediate state catch-up and event catch-up upon reconnection.
4. **Security & Zero Leaks:** Database connection strings, service credentials, and TMDB tokens must never leak to the client browser. Client access must be restricted to signed guest capability tokens and scoped channel subscriptions.

---

## 2. Decision Drivers

- **Serverless & Multi-Instance Compatibility:** Architecture must operate natively on multi-instance serverless deployments without requiring self-hosted stateful server processes.
- **Strict State Authority:** State mutations (roster freeze, vote recording, unanimous match transitions) must be atomic and server-authoritative, enforced by database transactions or atomic procedures.
- **Low-Latency Event Fan-out:** Room event propagation (lobby joins, votes cast, match found) must reach all room participants in <100ms.
- **Cost & Operational Simplicity:** Must provide a sustainable free tier for development/MVP and predictable scale-to-zero cost.
- **Clean Disconnect & Reconnect Recovery:** Snapshot-driven recovery with idempotent mutation semantics.

---

## 3. Comparative Architecture Analysis

| Evaluation Dimension | Candidate A: Managed Postgres + Realtime (Supabase) | Candidate B: Serverless Postgres (Neon) + SSE / Polling | Candidate C: Stateful Edge WebSockets (PartyKit / Durable Objects) | Candidate D: Redis Pub/Sub (Upstash) + SSE |
| :--- | :--- | :--- | :--- | :--- |
| **Persistence Engine** | Managed PostgreSQL (ACID, relational schema, JSONB, row-level locks) | Serverless PostgreSQL (Neon branching, ACID) | Ephemeral in-memory actor state + SQLite/Blob persistence | Key-value / Hashes (in-memory Redis data structures) |
| **Realtime Event Transport** | Managed WebSockets (Realtime Broadcast & WAL replication) | Server-Sent Events (SSE) or short HTTP polling | Stateful bi-directional WebSockets terminating on edge actor | SSE or long polling via serverless functions |
| **Vercel / Serverless Parity** | **Native.** Clients connect directly to managed Realtime endpoint; serverless functions mutate DB over connection pooler. | **Limited.** Vercel function duration limits (15s–300s) make long-lived SSE connections fragile and costly. | **External.** Requires deploying and managing separate edge infrastructure outside Vercel. | **Moderate.** Requires pub/sub polling or external SSE worker. |
| **Multi-Instance Handling** | **Flawless.** Serverless instances mutate PostgreSQL atomically; Supabase Realtime fans out events globally. | **Complex.** Multi-instance SSE requires separate Redis pub/sub backplane to synchronize instances. | **Single-actor.** Each room pinned to single edge actor; multi-region latency variations. | **Good.** Upstash Pub/Sub relays messages across instances. |
| **Concurrency & Atomic Consensus** | **Highest.** Native `BEGIN; SELECT ... FOR UPDATE; COMMIT;` transactions and atomic stored procedures. | **Highest.** Native PostgreSQL ACID transactions. | **High.** Single-threaded JavaScript event loop per room actor. | **Moderate.** Requires complex Redis Lua scripts for multi-key consistency. |
| **Cost & Free Tier Limits** | 500 MB DB, 200 concurrent Realtime connections, 50k MAU free. Generous MVP headroom. | Neon 0.5 GB free + Vercel execution duration billing for SSE streams. | Separate PartyKit / Cloudflare subscription required. | Pay-per-command; aggressive polling quickly drives command costs. |
| **Client Bundle Security** | Public anon key + RLS + server-authoritative API routes. Zero database secrets in browser. | Server routes only; zero secrets in client. | Client connects with room token; zero secrets in client. | Redis credentials held server-side; zero secrets in client. |

---

## 4. Decision

We designate **Candidate A: Managed PostgreSQL with Realtime Event Transport (Supabase Architecture)** as the authoritative persistence and real-time backend architecture for CineMatch:

1. **State Authority in PostgreSQL:**
   - Canonical room state, rosters, movie decks, and votes reside in PostgreSQL tables (`rooms`, `room_participants`, `room_deck`, `votes`).
   - All state transitions (`LOBBY` → `VOTING` → `MATCHED` / `NO_MATCH`) are executed by server-authoritative Next.js API routes using atomic database transactions.
   - Vote registration uses strict unique constraints (`UNIQUE(room_id, participant_id, movie_id)`) to enforce immutable, single-vote semantics per player/title.
   - Unanimous match calculation executes atomically within the vote transaction:
     ```sql
     -- Atomic consensus check within vote submission
     SELECT count(distinct participant_id) 
     FROM votes 
     WHERE room_id = $1 AND movie_id = $2 AND vote = 'LIKE';
     ```
     If the count equals the frozen roster size (`rooms.participant_count`), the room atomically transitions to `MATCHED` with `matched_movie_id = $2`.

2. **Decoupled Realtime Event Fan-out:**
   - Real-time client notifications utilize WebSocket channels scoped strictly by room code: `room:${room_code}`.
   - Events emitted: `participant_joined`, `roster_frozen`, `vote_recorded` (anonymized progress counter), `match_announced`, `round_ended`.
   - Client channels utilize broadcast mode for instant UI reactivity, backed by PostgreSQL change listeners for guaranteed durability.

3. **Multi-Instance Resilient Request Flow:**
   ```mermaid
   sequenceDiagram
       autonumber
       actor Player1 as Player 1 (Browser)
       actor Player2 as Player 2 (Browser)
       participant Edge1 as Vercel Serverless (Instance A)
       participant Edge2 as Vercel Serverless (Instance B)
       participant DB as PostgreSQL (Central State Authority)
       participant RT as Realtime Event Broker (WebSocket)

       Player1->>RT: Connect & Subscribe channel "room:ABC123"
       Player2->>RT: Connect & Subscribe channel "room:ABC123"

       Note over Player1,Edge1: Concurrent Voting on same Movie #550
       Player1->>Edge1: POST /api/room/ABC123/vote { movieId: 550, vote: 'LIKE' }
       Player2->>Edge2: POST /api/room/ABC123/vote { movieId: 550, vote: 'LIKE' }

       Edge1->>DB: BEGIN; Insert Vote; Check Consensus; COMMIT;
       Edge2->>DB: BEGIN; Insert Vote; Check Consensus; COMMIT;

       Note over DB: Atomic transaction serializes writes.<br/>Second write detects 100% consensus!
       DB-->>Edge2: Transitioned to MATCHED
       Edge2->>RT: Broadcast "match_announced" { movieId: 550 }
       RT-->>Player1: Push Event "match_announced"
       RT-->>Player2: Push Event "match_announced"
   ```

4. **Snapshot Reconnect Protocol:**
   - When a client reconnects after a network drop, it immediately issues an authenticated HTTP `GET /api/room/[code]` request.
   - The server returns the authoritative snapshot: current room status, frozen participant list, 20-title deck, and all votes cast by the reconnecting user.
   - The client hydrates its local card deck offset and re-subscribes to `room:${room_code}`.

5. **Security Contract:**
   - Browser bundles receive **zero database credentials** and **zero TMDB API keys**.
   - Client initializes only public real-time connection using signed anonymous capability tokens (`CINE_GUEST_SESSION`).
   - Mutations are exclusively accepted by server route handlers validating the guest session cookie.

---

## 5. Consequences

### Positive
- Fully serverless-compatible: Next.js API routes scale to zero on Vercel without keeping stateful socket connections open in serverless memory.
- Concurrency safety: PostgreSQL transaction isolation guarantees zero double-matches or vote race conditions across multi-instance serverless workers.
- Resilience: Transient network disconnects recover deterministically via snapshot hydration.
- Room isolation: Channels and row queries are hard-partitioned by `room_code` / `room_id`.

### Negative / Tradeoffs
- External managed service dependency (Supabase / PostgreSQL connection pooler).
- Free tier caps concurrent connections to 200 (sufficient for 40 simultaneous 5-player rooms during MVP; scaling beyond requires paid tier).

---

## 6. Implementation Roadmap
- **CINE-012:** Authoritative PostgreSQL schema, state machine transitions, and migration files.
- **CINE-013:** Anonymous guest identity, signed session capability tokens, and cookie handling.
- **CINE-014:** Room creation, 6-character room code generation, and capacity enforcement.
- **CINE-018:** Real-time event publication, channel authorization, and ordering.
