import type { Metadata } from "next";
import { RoomEntry } from "@/components/cinematch/room/RoomEntry";

export const metadata: Metadata = {
  title: "Join a Movie Night | CineMatch",
  robots: { index: false, follow: false },
};

export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomEntry initialCode={code} />;
}
