import { Clapperboard, Compass, Heart, List, TrendingUp } from "lucide-react";
import { FC } from "react";
import { Link, useLocation } from "react-router-dom";
import { buttonVariants } from "./ui/button";
import { CardDescription } from "./ui/card";

const Sidebar: FC = () => {
    const route = useLocation()
    return (
        <div className="flex flex-col border-r-2 border-secondary gap-6 w-1/6">
            <Link to={"/"} className={buttonVariants({ variant: "ghost", size: "lg", className: "rounded-none" })}>cinemania</Link>
            <div className="flex flex-col gap-8 p-4">
                <div className="flex flex-col gap-4">
                    <CardDescription>Browser</CardDescription>
                    <div className="flex flex-col gap-2">
                        <Link to="/" className={route.pathname === "/" ? buttonVariants({ className: "!justify-start flex gap-2" }) : buttonVariants({ variant: "ghost", className: "!justify-start flex gap-2" })}>
                            <Compass size={16} />
                            <span>Discover</span>
                        </Link>
                        <Link to="/trending" className={route.pathname === "/trending" ? buttonVariants({ className: "!justify-start flex gap-2" }) : buttonVariants({ variant: "ghost", className: "!justify-start flex gap-2" })}>
                            <TrendingUp size={16} />
                            <span>Trending</span>
                        </Link>
                        <Link to="/genres" className={route.pathname === "/genres" ? buttonVariants({ className: "!justify-start flex gap-2" }) : buttonVariants({ variant: "ghost", className: "!justify-start flex gap-2" })}>
                            <Clapperboard size={16} />
                            <span>Genres</span>
                        </Link>
                    </div>
                </div>
                <div className="flex flex-col gap-4">
                    <CardDescription>My Movies</CardDescription>
                    <div className="flex flex-col gap-2">
                        <Link to="/watchlist" className={route.pathname === "/watchlist" ? buttonVariants({ className: "!justify-start flex gap-2" }) : buttonVariants({ variant: "ghost", className: "!justify-start flex gap-2" })}>
                            <List size={16} />
                            <span>Watchlist</span>
                        </Link>
                        <Link to="/favorites" className={route.pathname === "/favorites" ? buttonVariants({ className: "!justify-start flex gap-2" }) : buttonVariants({ variant: "ghost", className: "!justify-start flex gap-2" })}>
                            <Heart size={16} />
                            <span>Favorites</span>
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Sidebar;