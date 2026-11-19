import { expect, it } from "vitest";
import { notifyAfterCommit } from "@/lib/server/realtime/notifyAfterCommit";

it("attempts notification dispatch without reversing a committed mutation when it fails", async () => {
  const seen: string[] = [];
  await notifyAfterCommit({ dispatchRoomNotifications: async (roomId: string) => { seen.push(roomId); throw new Error("offline"); } }, "room-a");
  expect(seen).toEqual(["room-a"]);
});
