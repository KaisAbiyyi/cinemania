import type { Metadata } from "next";
import { RoomEntry } from "@/components/cinematch/room/RoomEntry";

export const metadata: Metadata = {
  title: "Create or Join a Room | CineMatch",
  description: "Start a Movie Night screening room or join your friends using a six-character room code.",
};

export default function CineMatchRoomEntryPage() {
  return <RoomEntry />;
}
