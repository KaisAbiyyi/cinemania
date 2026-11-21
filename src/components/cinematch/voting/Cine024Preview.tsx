"use client";

import { useRef, useState } from "react";
import { CineMatchVotingPanel, type VotingSnapshot } from "@/components/cinematch/voting/CineMatchVotingPanel";
import type { RoomActionResult, VoteChoice } from "@/lib/realtime/roomActions";
import type { RealtimeStatus } from "@/lib/realtime/roomRealtime";

const candidate = {
  candidateId: "candidate-preview-one",
  position: 0,
  movieId: 27205,
  title: "Dream City",
  posterPath: null,
  posterUrl: null,
  overview: "An original demonstration synopsis. This is a simulated public UX test, not a TMDB result.",
  releaseDate: "2019-07-16",
  voteAverage: 7.8,
};
const second = {
  ...candidate,
  candidateId: "candidate-preview-two",
  position: 1,
  movieId: 14198,
  title: "Second Screening",
  overview: "Second card in the demo sequence to verify server-originated progress.",
};

function fixture(round: number): VotingSnapshot {
  return {
    room: {
      roomId: "preview-room",
      code: "DEMO24",
      invitePath: "/cinematch?code=DEMO24",
      status: "ACTIVE",
      stateVersion: 1,
      participantCount: 2,
      connectedParticipantCount: 2,
      maxParticipants: 5,
      minParticipantsToStart: 2,
      reconnectGraceSeconds: 90,
      canStart: false,
      canRetry: false,
      currentRoundId: "preview-round-" + round,
      latestRoundStatus: "ACTIVE",
      frozenQuorum: 2,
      deckFilter: { include_adult: false, language: "en-US", sort_by: "popularity.desc" },
      deckSize: 2,
      expectedDeckSize: 20,
      isDeckShortage: true,
      deck: [candidate, second],
      matchedMovieId: null,
      matchedCandidate: null,
      currentCandidateIndex: 0,
      currentCandidate: candidate,
      finishState: {
        status: "ACTIVE", code: "ROUND_ACTIVE", reason: null, recoverable: false,
        retryAvailable: false, retryEndpoint: null, matchedMovieId: null,
        message: "Round is active",
      },
      expiresAt: "2026-11-22T00:00:00Z",
      createdAt: "2026-11-21T00:00:00Z",
      participants: [
        { displayName: "You", role: "HOST", isConnected: true, joinedAt: "2026-11-21T00:00:00Z", isSelf: true, isEligibleVoter: true },
        { displayName: "Other guest", role: "MEMBER", isConnected: true, joinedAt: "2026-11-21T00:00:00Z", isSelf: false, isEligibleVoter: true },
      ],
    },
    viewer: {
      participantId: "fixture-self",
      displayName: "You",
      role: "HOST",
      isEligibleVoter: true,
      userVotes: {},
      nextCandidateIndex: 0,
    },
  };
}

/**
 * Public, clearly labelled contract fixture for deterministic pointer, touch, keyboard and delayed-ack
 * browser tests. It never hits the real room API or pretends to certify server security.
 */
export function Cine024Preview() {
  const round = useRef(1);
  const [snapshot, setSnapshot] = useState<VotingSnapshot>(() => fixture(1));
  const [connection, setConnection] = useState<RealtimeStatus>("live");
  const [calls, setCalls] = useState(0);
  const [delayMs, setDelayMs] = useState(450);
  const [dropAck, setDropAck] = useState(false);

  async function vote(input: { candidateId: string; movieId: number; vote: VoteChoice; roundId: string | null }): Promise<RoomActionResult> {
    setCalls((n) => n + 1);
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    if (dropAck) {
      return { ok: false, status: 0, code: "NETWORK_ERROR", message: "Simulated lost acknowledgement", stale: false, transient: true };
    }
    setSnapshot((current) => {
      if (current.room.currentRoundId !== input.roundId || current.room.currentCandidate?.candidateId !== input.candidateId) return current;
      return {
        room: { ...current.room, stateVersion: current.room.stateVersion + 1 },
        viewer: {
          ...current.viewer,
          userVotes: { ...current.viewer.userVotes, [input.candidateId]: input.vote },
          nextCandidateIndex: null,
        },
      };
    });
    return { ok: true, replayed: false, data: {} };
  }

  function advance() {
    setSnapshot((current) => {
      if (current.room.status !== "ACTIVE" || !current.room.currentCandidate) return current;
      const selected = current.viewer.userVotes?.[current.room.currentCandidate.candidateId];
      if (!selected) return current;
      if (selected === "LIKE") {
        return {
          room: {
            ...current.room, status: "MATCHED", stateVersion: current.room.stateVersion + 1,
            currentCandidate: null, currentCandidateIndex: null, matchedMovieId: current.room.currentCandidate.movieId,
            matchedCandidate: current.room.currentCandidate,
            finishState: { ...current.room.finishState, status: "MATCHED", code: "MATCH_FOUND", matchedMovieId: current.room.currentCandidate.movieId, message: "Unanimous LIKE confirmed by the simulated other voter." },
          },
          viewer: { ...current.viewer, nextCandidateIndex: null },
        };
      }
      return {
        room: {
          ...current.room, stateVersion: current.room.stateVersion + 1,
          currentCandidate: second, currentCandidateIndex: 1,
        },
        viewer: { ...current.viewer, nextCandidateIndex: 1 },
      };
    });
  }

  function reset() {
    round.current++;
    setSnapshot(fixture(round.current));
    setConnection("live");
    setCalls(0);
    setDropAck(false);
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6" data-testid="cine024-preview">
      <div className="rounded-xl border border-dashed border-[var(--cm-brand)] px-4 py-3 text-sm text-[var(--cm-ink)]">
        <strong>Simulated CINE-024 interaction contract — NOT a real room.</strong>
        <p>Assertions here certify UI behavior only; live API, Supabase, 2–5 clients and authorization require separate integration evidence.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--cm-ink)]">
        <button type="button" onClick={reset} className="min-h-[44px] rounded-lg border border-[var(--cm-border)] px-3">Reset demo</button>
        <button type="button" onClick={advance} className="min-h-[44px] rounded-lg border border-[var(--cm-border)] px-3">Simulate other voter</button>
        <button type="button" onClick={() => setConnection((s) => s === "live" ? "reconnecting" : "live")} className="min-h-[44px] rounded-lg border border-[var(--cm-border)] px-3">Toggle disconnect</button>
        <label className="flex min-h-[44px] items-center gap-2">Ack delay
          <select aria-label="Ack delay" value={delayMs} onChange={(event) => setDelayMs(Number(event.target.value))}
            className="min-h-[44px] rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface)] px-2">
            <option value={450}>450 ms</option><option value={1500}>1500 ms</option>
          </select>
        </label>
        <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" checked={dropAck} onChange={(event) => setDropAck(event.target.checked)} /> Simulate lost ack</label>
        <span data-testid="cine024-preview-calls" className="font-mono tabular-nums">Requests: {calls}</span>
      </div>
      <CineMatchVotingPanel snapshot={snapshot} connection={connection} onVote={vote} onResync={async () => undefined} />
    </div>
  );
}
