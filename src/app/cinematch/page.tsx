import type { Metadata } from "next";
import { CineMatchContractStudio } from "@/components/cinematch/CineMatchContractStudio";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata: Metadata = buildPageMetadata({
  title: "CineMatch Visual Direction & Contract",
  description:
    "Gemini-owned visual system, responsive screen states, accessibility contract, and interactive Movie Night design specification.",
  path: "/cinematch",
  keywords: ["cinematch", "movie night", "design system", "interaction contract"],
});

export default function CineMatchContractPage() {
  return <CineMatchContractStudio />;
}
