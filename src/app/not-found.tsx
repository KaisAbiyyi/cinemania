import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "404 Not Found | Cinemania",
  description: "Oops... The page you're looking for doesn't exist.",
};

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-8 m-auto w-96 text-center">
      <Image height={256} width={256} src="/notfound404.svg" alt="Page Not Found" />
      <CardTitle className="text-5xl">Oops...</CardTitle>
      <h1 className="text-lg text-muted-foreground">The page you&apos;re looking for doesn&apos;t exist.</h1>
      <Link href="/" className={buttonVariants()}>
        Back to Home
      </Link>
    </div>
  );
}
