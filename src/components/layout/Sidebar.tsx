"use client"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import { Clapperboard, Compass, TrendingUp, Tv } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible"

const BrowseItems = [
    {
        title: "Discover",
        url: "/",
        icon: Compass,
    },
    {
        title: "Trending",
        url: "/trending",
        icon: TrendingUp,
    },
]

const MoviesCollapsibleItems = [
    {
        title: "Popular",
        url: "/movie",
    },
    {
        title: "Now Playing",
        url: "/movie/now-playing"
    },
    {
        title: "Upcoming",
        url: "/movie/upcoming"
    },
    {
        title: "Top Rated",
        url: "/movie/top-rated"
    }
]
const TvCollapsibleItems = [
    {
        title: "Popular",
        url: "/tv",
    },
    {
        title: "Airing Today",
        url: "/tv/airing-today"
    },
    {
        title: "On TV",
        url: "/tv/on-tv"
    },
    {
        title: "Top Rated",
        url: "/tv/top-rated"
    }
]

// const MyMovieItems = [
//     {
//         title: "Watchlist",
//         url: "/watchlist",
//         icon: List
//     },
//     {
//         title: "Favorites",
//         url: "/favorites",
//         icon: Heart
//     }
// ]

export function AppSidebar() {
    const pathname = usePathname()

    return (
        <Sidebar collapsible="icon">
            <SidebarHeader>
                <SidebarGroup>
                    <SidebarGroupLabel asChild>
                        <Link href={"/"} className="w-full justify-center">
                            cinemania
                        </Link>
                    </SidebarGroupLabel>

                </SidebarGroup>
            </SidebarHeader>
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Browse</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {BrowseItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton isActive={pathname === item.url} asChild>
                                        <a href={item.url}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </a>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                            <Collapsible className="group/collapsible">
                                <SidebarMenuItem>
                                    <CollapsibleTrigger asChild>
                                        <SidebarMenuButton>
                                            <Clapperboard />
                                            Movies
                                        </SidebarMenuButton>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <SidebarMenuSub>
                                            {MoviesCollapsibleItems.map((item) => (
                                                <SidebarMenuSubItem key={item.title} className="hover:underline w-fit">
                                                    <a href={item.url}>
                                                        {item.title}
                                                    </a>
                                                </SidebarMenuSubItem>
                                            ))}
                                        </SidebarMenuSub>
                                    </CollapsibleContent>
                                </SidebarMenuItem>
                            </Collapsible>
                            <Collapsible className="group/collapsible">
                                <SidebarMenuItem>
                                    <CollapsibleTrigger asChild>
                                        <SidebarMenuButton>
                                            <Tv />
                                            TV Shows
                                        </SidebarMenuButton>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <SidebarMenuSub>
                                            {TvCollapsibleItems.map((item) => (
                                                <SidebarMenuSubItem key={item.title} className="hover:underline w-fit">
                                                    <a href={item.url}>
                                                        {item.title}
                                                    </a>
                                                </SidebarMenuSubItem>
                                            ))}
                                        </SidebarMenuSub>
                                    </CollapsibleContent>
                                </SidebarMenuItem>
                            </Collapsible>
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                {/* <SidebarGroup>
                    <SidebarGroupLabel>My Movies</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {MyMovieItems.map((item) => (
                                <SidebarMenuItem key={item.title}>
                                    <SidebarMenuButton asChild>
                                        <a href={item.url}>
                                            <item.icon />
                                            <span>{item.title}</span>
                                        </a>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup> */}
            </SidebarContent>
            <SidebarFooter />
        </Sidebar>
    )
}
