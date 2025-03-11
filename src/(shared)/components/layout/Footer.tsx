import { Github, Instagram, Linkedin, Mail, Twitter } from "lucide-react";
import { FC } from "react";
import { CardDescription, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import Link from "next/link";

const Footer: FC = () => {
    return (
        <footer className="p-8 border-t" itemScope itemType="https://schema.org/Organization">
            <div className="grid grid-cols-1 gap-8 mx-auto md:grid-cols-4 md:text-left">

                {/* 🏆 Brand & Navigasi */}
                <nav aria-label="Cinemania Overview" className="flex flex-col gap-4">
                    <CardTitle className="text-lg" itemProp="name">Cinemania</CardTitle>
                    <CardDescription itemProp="description">
                        Cinemania is a movie discovery web app inspired by TMDB, allowing users to explore trending and latest movies with details like synopsis, release date, ratings, and cast.
                    </CardDescription>
                </nav>

                <nav aria-label="Site Navigation" className="flex flex-col gap-4">
                    <CardTitle className="text-lg">Browse</CardTitle>
                    <div className="flex flex-col gap-2">
                        <Link href="/" className="transition text-muted-foreground hover:text-secondary-foreground">Home</Link>
                        <Link href="/movie" className="transition text-muted-foreground hover:text-secondary-foreground">Movies</Link>
                        <Link href="/tv" className="transition text-muted-foreground hover:text-secondary-foreground">TV Shows</Link>
                        <Link href="/about" className="transition text-muted-foreground hover:text-secondary-foreground">About</Link>
                    </div>
                </nav>

                {/* 👤 Personal Branding */}
                <address aria-label="Personal Links" className="flex flex-col gap-4 not-italic">
                    <CardTitle className="text-lg">Personal</CardTitle>
                    <div className="flex flex-col gap-2">
                        <Link href="https://kaisabiyyi.com" target="_blank" rel="noopener noreferrer nofollow" className="transition text-muted-foreground hover:text-secondary-foreground">Portfolio</Link>
                        <Link href="https://kaisabiyyi.com/assets/resume-KaisAbiyyi.pdf" target="_blank" rel="noopener noreferrer nofollow" className="transition text-muted-foreground hover:text-secondary-foreground">Resume</Link>
                    </div>
                </address>

                {/* 🌍 Sosial Media */}
                <address aria-label="Social Media Links" className="flex flex-col gap-4 not-italic">
                    <CardTitle className="text-lg">Social</CardTitle>
                    <div className="flex flex-col gap-2 md:justify-start">
                        <Link href="https://github.com/KaisAbiyyi" target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ variant: "secondary", className: "!justify-start" })}>
                            <Github size={24} />
                            Github
                        </Link>
                        <Link href="https://linkedin.com/in/kais-abiyyi-109572208" target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ variant: "secondary", className: "!justify-start" })}>
                            <Linkedin size={24} />
                            LinkedIn
                        </Link>
                        <Link href="https://x.com/kaisabiyyi" target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ variant: "secondary", className: "!justify-start" })}>
                            <Twitter size={24} />
                            X
                        </Link>
                        <Link href="https://instagram.com/kaisabiyyi" target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ variant: "secondary", className: "!justify-start" })}>
                            <Instagram size={24} />
                            Instagram
                        </Link>
                        <Link href="mailto:business.kaisabiyyi@gmail.com" className={buttonVariants({ variant: "secondary", className: "!justify-start" })}>
                            <Mail size={24} />
                            Email
                        </Link>
                    </div>
                </address>

            </div>

            {/* Credit to TMDB */}
            <div className="mt-10 text-sm text-center text-gray-500">
                This product uses the <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline">TMDB API</a> but is not endorsed or certified by TMDB.
            </div>

            {/* Copyright */}
            <div className="mt-5 text-sm text-center text-gray-400">
                © {new Date().getFullYear()} <span itemProp="name">Cinemania</span>. Built by <a href="https://kaisabiyyi.com" className="text-primary hover:underline" itemProp="creator">Kais Abiyyi</a>.
            </div>
        </footer>
    );
};

export default Footer;
