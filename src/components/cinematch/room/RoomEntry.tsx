"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Clapperboard, Film, LogIn, Plus, Users } from "lucide-react";
import { CineMatchAlertCard } from "@/components/cinematch/CineMatchPrimitives";
import { isRoomPayload, normalizeRoomCode, roomErrorMessage, roomRequest, RoomClientError } from "./clientApi";

type Mode = "create" | "join";

export function RoomEntry({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialCode ? "join" : "create");
  const [name, setName] = useState("");
  const [code, setCode] = useState(initialCode);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RoomClientError | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setError(null);
    const cleanedName = name.normalize("NFKC").trim();
    if (Array.from(cleanedName).length < 1 || Array.from(cleanedName).length > 32) {
      setError(new RoomClientError("INVALID_DISPLAY_NAME", "Your name must contain 1–32 characters.", 400));
      return;
    }
    const normalizedCode = mode === "join" ? normalizeRoomCode(code) : null;
    if (mode === "join" && !normalizedCode) {
      setError(new RoomClientError("INVALID_ROOM_CODE", "Enter a valid six-character room code.", 400));
      return;
    }
    setPending(true);
    try {
      const response = await roomRequest<unknown>(
        mode === "create" ? "/api/rooms" : "/api/rooms/join",
        { method: "POST", body: mode === "create" ? { displayName: cleanedName } : { code: normalizedCode, displayName: cleanedName } }
      );
      if (!isRoomPayload(response)) throw new RoomClientError("INVALID_RESPONSE", "The room server returned invalid data.", 502);
      router.push("/cinematch/room/" + encodeURIComponent(response.room.roomId));
    } catch (cause) {
      setError(cause instanceof RoomClientError ? cause : new RoomClientError("UNKNOWN", "Could not open the room.", 0));
      setPending(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl min-w-0 space-y-7 px-4 py-8 sm:px-6 sm:py-12" data-testid="cm-room-entry">
      <div className="space-y-3">
        <Link href="/cinematch" className="inline-flex min-h-[44px] items-center text-sm font-medium text-[var(--cm-brand-text)] underline underline-offset-4">CineMatch design studio</Link>
        <div className="flex items-center gap-3 text-[var(--cm-brand-text)]">
          <Clapperboard size={28} aria-hidden="true" />
          <p className="text-xs font-bold uppercase tracking-[0.2em]">CineMatch Movie Night</p>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--cm-ink)] sm:text-4xl">Your next movie, chosen together.</h1>
        <p className="max-w-2xl text-[var(--cm-ink-muted)]">Invite two to five people into a private room. No account needed. The host starts the screening; everyone gets a vote.</p>
      </div>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className="min-w-0 space-y-5 rounded-2xl border border-[var(--cm-border)] bg-[var(--cm-surface)] p-5 shadow-sm sm:p-7" aria-label="Create or join a screening room">
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Room action">
            <button type="button" aria-pressed={mode === "create"} onClick={() => { setMode("create"); setError(null); }} disabled={pending}
              className="min-h-[48px] rounded-lg border border-[var(--cm-border)] px-3 text-sm font-semibold text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand)] aria-pressed:bg-[var(--cm-brand)] aria-pressed:text-[var(--cm-brand-ink)]">
              <Plus className="mr-1 inline h-4 w-4" aria-hidden="true" /> Create
            </button>
            <button type="button" aria-pressed={mode === "join"} onClick={() => { setMode("join"); setError(null); }} disabled={pending}
              className="min-h-[48px] rounded-lg border border-[var(--cm-border)] px-3 text-sm font-semibold text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand)] aria-pressed:bg-[var(--cm-brand)] aria-pressed:text-[var(--cm-brand-ink)]">
              <LogIn className="mr-1 inline h-4 w-4" aria-hidden="true" /> Join
            </button>
          </div>
          <h2 className="text-xl font-bold text-[var(--cm-ink)]">{mode === "create" ? "Create a screening room" : "Join a friend&apos;s room"}</h2>
          <form onSubmit={(event) => void submit(event)} className="space-y-5" noValidate>
            <div className="space-y-2">
              <label htmlFor="cm-display-name" className="block text-sm font-semibold text-[var(--cm-ink)]">Your display name</label>
              <input id="cm-display-name" name="displayName" type="text" autoComplete="nickname" required maxLength={50} value={name}
                onChange={(event) => setName(event.target.value)} disabled={pending} placeholder="e.g. Movie fan"
                className="min-h-[48px] w-full rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface-elevated)] px-3 text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand)]" />
              <p className="text-xs text-[var(--cm-ink-muted)]">1–32 characters; visible to the room.</p>
            </div>
            {mode === "join" && (
              <div className="space-y-2">
                <label htmlFor="cm-join-code" className="block text-sm font-semibold text-[var(--cm-ink)]">Six-character room code or invite link</label>
                <input id="cm-join-code" name="roomCode" type="text" required autoCapitalize="characters" autoCorrect="off" spellCheck={false} value={code}
                  onChange={(event) => setCode(event.target.value)} disabled={pending} placeholder="ABC234"
                  className="min-h-[48px] w-full min-w-0 rounded-lg border border-[var(--cm-border)] bg-[var(--cm-surface-elevated)] px-3 font-mono text-[var(--cm-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand)]" />
              </div>
            )}
            {error && <CineMatchAlertCard code={error.code} message={roomErrorMessage(error)} retryAfterSeconds={error.retryAfterSeconds} />}
            <button type="submit" disabled={pending} aria-busy={pending} data-testid="cm-room-submit"
              className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-lg bg-[var(--cm-brand)] px-5 py-3 text-sm font-bold text-[var(--cm-brand-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)] disabled:cursor-wait disabled:opacity-60">
              <Film className="h-4 w-4" aria-hidden="true" />
              {pending ? "Opening room…" : mode === "create" ? "Create Screening Room" : "Join Screening Room"}
            </button>
          </form>
        </section>
        <aside className="min-w-0 space-y-4 rounded-2xl border border-[var(--cm-border)] bg-[var(--cm-surface-subtle)] p-5 sm:p-7">
          <Users className="h-7 w-7 text-[var(--cm-brand-text)]" aria-hidden="true" />
          <h2 className="text-xl font-bold text-[var(--cm-ink)]">Movie night, minus the debate.</h2>
          <p className="text-sm leading-relaxed text-[var(--cm-ink-muted)]">Share a code with friends. The lobby shows who's connected, and the host can start with 2–5 participants. Film selections are decided by the server.</p>
          <p className="text-sm font-semibold text-[var(--cm-ink)]">Private room access uses secure browser cookies. Never share a browser session.</p>
        </aside>
      </div>
    </main>
  );
}
