import type { Metadata } from "next";
import { RoomLobby } from "@/components/cinematch/room/RoomLobby";

export const metadata: Metadata = {
  title: "Screening Room | CineMatch",
  robots: { index: false, follow: false },
};

export default async function CineMatchLobbyPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <RoomLobby roomId={roomId} />;
}
