import { Clapperboard, Compass, Heart, List, TrendingUp, Tv } from "lucide-react";
import { FC } from "react";
import { Link, useLocation } from "react-router-dom";
import { buttonVariants } from "./ui/button";
import { CardDescription } from "./ui/card";
import { Separator } from "./ui/separator";

const Sidebar: FC = () => {
    const route = useLocation()
    return (
        <div className="fixed top-0 bottom-0 z-50 flex flex-col w-1/6 gap-6 border-r-2 border-primary/25">
            <Link to={"/"} className={buttonVariants({ variant: "ghost", size: "lg", className: "rounded-none" })}>
                <span className="hidden duration-200 ease-out md:block">cinemania</span>
                <span className="block duration-200 ease-out md:hidden">ci</span>
            </Link>
            <div className="flex flex-col gap-8 p-2 md:p-4">
                <div className="flex flex-col gap-4">
                    <Separator className="block md:hidden" orientation="horizontal" />
                    <CardDescription className="hidden md:block">Browser</CardDescription>
                    <div className="flex flex-col gap-2">
                        <Link to="/" className={route.pathname === "/" ?
                            buttonVariants({ className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" }) :
                            buttonVariants({ variant: "ghost", className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" })}>
                            <Compass className="size-6 md:size-4" />
                            <span className="hidden duration-200 ease-out md:block">Discover</span>
                        </Link>
                        <Link to="/trending" className={route.pathname === "/trending" ?
                            buttonVariants({ className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" }) :
                            buttonVariants({ variant: "ghost", className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" })}>
                            <TrendingUp className="size-6 md:size-4" />
                            <span className="hidden duration-200 ease-out md:block">Trending</span>
                        </Link>
                        <Link to="/movie" className={route.pathname === "/movie" ?
                            buttonVariants({ className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" }) :
                            buttonVariants({ variant: "ghost", className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" })}>
                            <Clapperboard className="size-6 md:size-4" />
                            <span className="hidden duration-200 ease-out md:block">Movies</span>
                        </Link>
                        <Link to="/tv" className={route.pathname === "/tv" ?
                            buttonVariants({ className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" }) :
                            buttonVariants({ variant: "ghost", className: "!justify-center md:!justify-start !h-fit !p-1 md:!p-2 flex gap-2" })}>
                            <Tv className="size-6 md:size-4" />
                            <span className="hidden duration-200 ease-out md:block">TV Shows</span>
                        </Link>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <Separator className="block md:hidden" orientation="horizontal" />
                    <CardDescription className="hidden md:block">My Movies</CardDescription>
                    <div className="flex flex-col gap-2">
                        <Link to="/watchlist" className={route.pathname === "/watchlist" ? buttonVariants({ className: "!justify-center md:!justify-start !p-1 md:!p-2 flex gap-2" }) : buttonVariants({ variant: "ghost", className: "!justify-center md:!justify-start !p-1 md:!p-2 flex gap-2" })}>
                            <List className="size-6 md:size-4" />
                            <span className="hidden duration-200 ease-out md:block">Watchlist</span>
                        </Link>
                        <Link to="/favorites" className={route.pathname === "/favorites" ? buttonVariants({ className: "!justify-center md:!justify-start !p-1 md:!p-2 flex gap-2" }) : buttonVariants({ variant: "ghost", className: "!justify-center md:!justify-start !p-1 md:!p-2 flex gap-2" })}>
                            <Heart className="size-6 md:size-4" />
                            <span className="hidden duration-200 ease-out md:block">Favorites</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Sidebar;