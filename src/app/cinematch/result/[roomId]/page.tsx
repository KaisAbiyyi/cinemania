import type { Metadata } from "next";
import { RoomResultExperience } from "@/components/cinematch/result/RoomResultExperience";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "Movie Night Result — CineMatch",
  description: "Your private, server-confirmed CineMatch Movie Night result.",
  path: "/cinematch/result",
  keywords: ["CineMatch", "Movie Night", "match result"],
});

export default async function CineMatchResultPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <RoomResultExperience key={roomId} roomId={roomId} />;
}
