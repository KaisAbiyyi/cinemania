import type { Metadata } from "next";
import { Cine024Preview } from "@/components/cinematch/voting/Cine024Preview";

export const metadata: Metadata = {
  title: "CINE-024 UI Contract Preview — Simulated Only",
  robots: { index: false, follow: false },
};

export default function Cine024PreviewPage() {
  return <Cine024Preview />;
}
