/** Broadcasts are invalidation hints; only an authenticated HTTP snapshot is state. */
export function createRoomReconciler<T extends { stateVersion: number }>(options: {
  loadSnapshot: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
}) {
  let lastVersion = -1;
  let requestedVersion = -1;
  let requestGeneration = 0;
  let forcedGeneration = 0;
  let inFlight: Promise<void> | null = null;

  function refresh(force: boolean, version = -1): Promise<void> {
    if (!force && (!Number.isSafeInteger(version) || version < 0 || version <= lastVersion)) {
      return inFlight ?? Promise.resolve();
    }
    requestedVersion = Math.max(requestedVersion, version);
    requestGeneration++;
    if (force) forcedGeneration++;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      let completedGeneration = 0;
      while (completedGeneration < requestGeneration) {
        const observedGeneration = requestGeneration;
        const observedForce = forcedGeneration;
        const snapshot = await options.loadSnapshot();
        if (!Number.isSafeInteger(snapshot.stateVersion) || snapshot.stateVersion < 0) {
          throw new Error("Invalid authoritative snapshot version");
        }
        if (snapshot.stateVersion > lastVersion) {
          lastVersion = snapshot.stateVersion;
          options.onSnapshot(snapshot);
        }
        completedGeneration = observedGeneration;
        if (lastVersion >= requestedVersion && observedForce === forcedGeneration) completedGeneration = requestGeneration;
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    connected: () => refresh(true),
    notify: (version: number) => refresh(false, version),
    /**
     * Accepts a snapshot that is already authoritative, such as the body of a successful
     * mutation response, without another round trip. It uses the same monotonic version gate
     * as fetched snapshots so a later hint or a replayed response can never deliver it twice
     * or move the view backwards.
     */
    accept: (snapshot: T): boolean => {
      if (!Number.isSafeInteger(snapshot.stateVersion) || snapshot.stateVersion < 0) return false;
      if (snapshot.stateVersion <= lastVersion) return false;
      lastVersion = snapshot.stateVersion;
      options.onSnapshot(snapshot);
      return true;
    },
    /** Highest authoritative state version delivered so far, or -1 before the first snapshot. */
    currentVersion: () => lastVersion,
  };
}
