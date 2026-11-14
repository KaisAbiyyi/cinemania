import {
  Candidate,
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  RoomStatus,
  Vote,
  VoteType,
} from "@/db/schema";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_OPERATION_ID_LENGTH = 128;

export class VotePayloadError extends Error {
  public readonly code = "INVALID_VOTE_PAYLOAD";
  public readonly status = 400;

  constructor(message = "Invalid vote payload") {
    super(message);
    this.name = "VotePayloadError";
  }
}

export class ImmutableVoteError extends Error {
  public readonly code = "VOTE_IMMUTABLE";
  public readonly status = 409;

  constructor(message = "Vote is immutable once recorded and cannot be changed") {
    super(message);
    this.name = "ImmutableVoteError";
  }
}

export class OperationConflictError extends Error {
  public readonly code = "OPERATION_ID_CONFLICT";
  public readonly status = 409;

  constructor(
    message = "operationId has already been used for different vote parameters"
  ) {
    super(message);
    this.name = "OperationConflictError";
  }
}

export class VoterNotEligibleError extends Error {
  public readonly code = "VOTER_NOT_ELIGIBLE";
  public readonly status = 403;

  constructor(message = "Participant is not part of this round's frozen voter roster") {
    super(message);
    this.name = "VoterNotEligibleError";
  }
}

export interface ParsedVoteSubmissionPayload {
  candidateId: string;
  movieId: number;
  vote: VoteType;
  roundId: string | null;
  operationId: string | null;
}

export interface CandidateConsensusResult {
  candidateId: string;
  eligibleVoterCount: number;
  votesCastCount: number;
  likeCount: number;
  skipCount: number;
  isMatched: boolean;
  isResolvedWithoutMatch: boolean;
  isPending: boolean;
}

export interface DeckProgressionResult {
  nextStatus: RoomStatus;
  matchedCandidate: Candidate | null;
  matchedMovieId: number | null;
  currentCandidateIndex: number | null;
  currentCandidate: Candidate | null;
  candidateResults: CandidateConsensusResult[];
  allResolvedWithoutMatch: boolean;
  resolvedCount: number;
}

export function normalizeOperationId(
  rawValue: unknown,
  fieldName = "operationId"
): string | null {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== "string") {
    throw new VotePayloadError(`${fieldName} must be a non-empty string`);
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new VotePayloadError(`${fieldName} must not be empty`);
  }
  if (trimmed.length > MAX_OPERATION_ID_LENGTH) {
    throw new VotePayloadError(
      `${fieldName} must be at most ${MAX_OPERATION_ID_LENGTH} characters`
    );
  }
  if (CONTROL_CHAR_PATTERN.test(trimmed)) {
    throw new VotePayloadError(`${fieldName} contains invalid control characters`);
  }
  return trimmed;
}

export function extractOperationIdFromHeaders(headers: Headers): string | null {
  const idempotencyKeyRaw = headers.get("idempotency-key");
  const operationHeaderRaw = headers.get("x-operation-id");

  const idempotencyKey =
    idempotencyKeyRaw !== null
      ? normalizeOperationId(idempotencyKeyRaw, "Idempotency-Key header")
      : null;
  const operationHeader =
    operationHeaderRaw !== null
      ? normalizeOperationId(operationHeaderRaw, "x-operation-id header")
      : null;

  if (idempotencyKey && operationHeader && idempotencyKey !== operationHeader) {
    throw new VotePayloadError(
      "Conflicting Idempotency-Key and x-operation-id header values"
    );
  }

  return idempotencyKey ?? operationHeader;
}

export function parseVoteSubmissionPayload(
  body: unknown,
  headerOperationId?: string | null
): ParsedVoteSubmissionPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new VotePayloadError("Request body must be a JSON object");
  }

  const record = body as Record<string, unknown>;

  if (typeof record.candidateId !== "string" || !UUID_PATTERN.test(record.candidateId.trim())) {
    throw new VotePayloadError("candidateId must be a valid UUID");
  }
  const candidateId = record.candidateId.trim();

  if (
    typeof record.movieId !== "number" ||
    !Number.isSafeInteger(record.movieId) ||
    record.movieId <= 0
  ) {
    throw new VotePayloadError("movieId must be a positive integer");
  }

  if (record.vote !== "LIKE" && record.vote !== "SKIP") {
    throw new VotePayloadError('vote must be strictly "LIKE" or "SKIP"');
  }

  let roundId: string | null = null;
  if (record.roundId !== undefined && record.roundId !== null) {
    if (typeof record.roundId !== "string" || !UUID_PATTERN.test(record.roundId.trim())) {
      throw new VotePayloadError("roundId must be a valid UUID when provided");
    }
    roundId = record.roundId.trim();
  }

  const normalizedHeaderOpId = normalizeOperationId(headerOperationId, "operationId header");
  const normalizedBodyOpId = normalizeOperationId(record.operationId, "operationId");

  if (
    normalizedHeaderOpId !== null &&
    normalizedBodyOpId !== null &&
    normalizedHeaderOpId !== normalizedBodyOpId
  ) {
    throw new VotePayloadError("operationId in request header and body must match");
  }

  return {
    candidateId,
    movieId: record.movieId,
    vote: record.vote,
    roundId,
    operationId: normalizedBodyOpId ?? normalizedHeaderOpId ?? null,
  };
}

export function assertValidEligibleVoterRoster(
  eligibleVoterIds: ReadonlySet<string>
): number {
  const count = eligibleVoterIds.size;
  if (count < MIN_PARTICIPANTS || count > MAX_PARTICIPANTS) {
    throw new Error(
      `Frozen round voter roster size must be between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}, got ${count}`
    );
  }
  return count;
}

/**
 * Evaluates unanimous consensus for a single persisted deck candidate against
 * the frozen round_participants voter roster.
 *
 * Strictly unanimous rule:
 * - MATCHED only when EVERY frozen voter has voted AND zero SKIP votes exist (likeCount === quorum).
 * - Any SKIP vote permanently precludes a unanimous match for that candidate.
 * - Resolved without match only when EVERY frozen voter has cast a vote AND at least one SKIP exists.
 */
export function evaluateCandidateConsensus(
  candidateId: string,
  candidateVotes: readonly Pick<Vote, "participant_id" | "vote">[],
  eligibleVoterIds: ReadonlySet<string>
): CandidateConsensusResult {
  const eligibleVoterCount = assertValidEligibleVoterRoster(eligibleVoterIds);

  const seenParticipants = new Set<string>();
  let likeCount = 0;
  let skipCount = 0;

  for (const record of candidateVotes) {
    if (!eligibleVoterIds.has(record.participant_id)) {
      continue;
    }
    if (seenParticipants.has(record.participant_id)) {
      throw new Error(
        `Duplicate vote encountered for participant ${record.participant_id} on candidate ${candidateId}`
      );
    }
    seenParticipants.add(record.participant_id);
    if (record.vote === "LIKE") {
      likeCount += 1;
    } else if (record.vote === "SKIP") {
      skipCount += 1;
    }
  }

  const votesCastCount = likeCount + skipCount;
  const allVoted = votesCastCount === eligibleVoterCount;
  const isMatched = allVoted && likeCount === eligibleVoterCount && skipCount === 0;
  const isResolvedWithoutMatch = allVoted && skipCount > 0;

  return {
    candidateId,
    eligibleVoterCount,
    votesCastCount,
    likeCount,
    skipCount,
    isMatched,
    isResolvedWithoutMatch,
    isPending: !allVoted,
  };
}

/**
 * Evaluates full-deck unanimous matching progression for a round.
 * Supports 1..20 persisted candidates (including deterministic shortages from CINE-016).
 */
export function evaluateDeckProgression(
  candidates: readonly Candidate[],
  votes: readonly Pick<Vote, "candidate_id" | "participant_id" | "vote">[],
  eligibleVoterIds: ReadonlySet<string>
): DeckProgressionResult {
  assertValidEligibleVoterRoster(eligibleVoterIds);
  if (candidates.length === 0) {
    throw new Error("Cannot evaluate deck progression without persisted candidates");
  }

  const orderedCandidates = [...candidates].sort((a, b) => a.position - b.position);
  const votesByCandidate = new Map<string, Pick<Vote, "participant_id" | "vote">[]>();

  for (const vote of votes) {
    let list = votesByCandidate.get(vote.candidate_id);
    if (!list) {
      list = [];
      votesByCandidate.set(vote.candidate_id, list);
    }
    list.push(vote);
  }

  const candidateResults: CandidateConsensusResult[] = [];
  let matchedCandidate: Candidate | null = null;
  let currentCandidateIndex: number | null = null;
  let currentCandidate: Candidate | null = null;
  let resolvedCount = 0;

  for (let index = 0; index < orderedCandidates.length; index++) {
    const candidate = orderedCandidates[index]!;
    const result = evaluateCandidateConsensus(
      candidate.id,
      votesByCandidate.get(candidate.id) ?? [],
      eligibleVoterIds
    );
    candidateResults.push(result);

    if (result.isMatched && matchedCandidate === null) {
      matchedCandidate = candidate;
    }
    if (result.isResolvedWithoutMatch) {
      resolvedCount += 1;
    } else if (!result.isMatched && currentCandidateIndex === null) {
      currentCandidateIndex = index;
      currentCandidate = candidate;
    }
  }

  const allResolvedWithoutMatch =
    matchedCandidate === null &&
    candidateResults.every((result) => result.isResolvedWithoutMatch);

  let nextStatus: RoomStatus = "ACTIVE";
  if (matchedCandidate !== null) {
    nextStatus = "MATCHED";
  } else if (allResolvedWithoutMatch) {
    nextStatus = "EXHAUSTED";
  }

  return {
    nextStatus,
    matchedCandidate,
    matchedMovieId: matchedCandidate ? matchedCandidate.movie_id : null,
    currentCandidateIndex,
    currentCandidate,
    candidateResults,
    allResolvedWithoutMatch,
    resolvedCount,
  };
}
