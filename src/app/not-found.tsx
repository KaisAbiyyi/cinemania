import Link from "next/link";
import { Metadata } from "next";
import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "404 Not Found | Cinemania",
  description: "Oops... The page you're looking for doesn't exist.",
};

export default function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-8 m-auto w-96 text-center">
      <img src="/notfound404.svg" alt="Page Not Found" className="w-64 h-64" />
      <CardTitle className="text-5xl">Oops...</CardTitle>
      <h1 className="text-lg text-muted-foreground">
        The page you're looking for doesn't exist.
      </h1>
      <Link href="/" className={buttonVariants()}>
        Back to Home
      </Link>
    </div>
  );
}
