import type { Metadata } from "next";
import Link from "next/link";
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
  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6">
        <Link href="/cinematch/room" className="inline-flex min-h-[48px] items-center rounded-lg bg-[var(--cm-brand)] px-5 text-sm font-bold text-[var(--cm-brand-ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cm-brand-text)]">
          Create or Join a Real Movie Night Room
        </Link>
      </div>
      <CineMatchContractStudio />
    </>
  );
}
