import { Github, Instagram, Linkedin, Mail, Twitter } from "lucide-react";
import { FC } from "react";
import { CardDescription, CardTitle } from "../ui/card";
import { buttonVariants } from "../ui/button";
import Link from "next/link";

const Footer: FC = () => {
    const linkClass = "transition text-muted-foreground hover:text-secondary-foreground";
    const socialButtonClass = buttonVariants({ variant: "ghost", className: "!justify-start hover:bg-primary transition-all duration-75 ease-in hover:text-primary-foreground" });

    const navLinks = [
        { label: "Home", href: "/" },
        { label: "Movies", href: "/movie" },
        { label: "TV Shows", href: "/tv" },
        { label: "About", href: "/about" },
    ];

    const personalLinks = [
        { label: "Portfolio", href: "https://kaisabiyyi.com" },
        { label: "Resume", href: "https://kaisabiyyi.com/assets/resume-KaisAbiyyi.pdf" },
    ];

    const socialLinks = [
        { label: "Github", href: "https://github.com/KaisAbiyyi", icon: <Github size={24} /> },
        { label: "LinkedIn", href: "https://linkedin.com/in/kais-abiyyi-109572208", icon: <Linkedin size={24} /> },
        { label: "X", href: "https://x.com/kaisabiyyi", icon: <Twitter size={24} /> },
        { label: "Instagram", href: "https://instagram.com/kaisabiyyi", icon: <Instagram size={24} /> },
        { label: "Email", href: "mailto:business.kaisabiyyi@gmail.com", icon: <Mail size={24} /> },
    ];

    return (
        <footer className="p-8 border-t" itemScope itemType="https://schema.org/Organization">
            <div className="grid grid-cols-1 gap-8 mx-auto md:grid-cols-4 md:text-left">
                {/* Brand & Overview */}
                <nav aria-label="Cinemania Overview" className="flex flex-col gap-4">
                    <CardTitle className="text-lg" itemProp="name">Cinemania</CardTitle>
                    <CardDescription itemProp="description">
                        Cinemania is a movie discovery web app inspired by TMDB, allowing users to explore trending and latest movies with details like synopsis, release date, ratings, and cast.
                    </CardDescription>
                </nav>

                {/* Navigation */}
                <nav aria-label="Site Navigation" className="flex flex-col gap-4">
                    <CardTitle className="text-lg">Browse</CardTitle>
                    <div className="flex flex-col gap-2">
                        {navLinks.map(({ label, href }) => (
                            <Link key={href} href={href} className={linkClass}>{label}</Link>
                        ))}
                    </div>
                </nav>

                {/* Personal Branding */}
                <address aria-label="Personal Links" className="flex flex-col gap-4 not-italic">
                    <CardTitle className="text-lg">Personal</CardTitle>
                    <div className="flex flex-col gap-2">
                        {personalLinks.map(({ label, href }) => (
                            <Link key={href} href={href} target="_blank" rel="noopener noreferrer nofollow" className={linkClass}>{label}</Link>
                        ))}
                    </div>
                </address>

                {/* Social Media */}
                <address aria-label="Social Media Links" className="flex flex-col gap-4 not-italic">
                    <CardTitle className="text-lg">Social</CardTitle>
                    <div className="flex flex-col gap-2 md:justify-start">
                        {socialLinks.map(({ label, href, icon }) => (
                            <Link key={href} href={href} target="_blank" rel="noopener noreferrer nofollow" className={socialButtonClass}>
                                {icon} {label}
                            </Link>
                        ))}
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