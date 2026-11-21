import type { Metadata } from "next";
import { CineMatchVotingClient } from "@/components/cinematch/voting/CineMatchVotingClient";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "CineMatch Voting Room",
  description: "Vote on a shared, server-authoritative Movie Night deck with accessible Like and Skip controls.",
  path: "/cinematch/vote",
  keywords: ["cinematch", "movie night", "swipe", "voting"],
});

export default async function CineMatchVotingPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <CineMatchVotingClient roomId={roomId} />;
}
