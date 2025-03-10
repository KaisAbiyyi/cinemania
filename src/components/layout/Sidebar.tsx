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
} from "@/components/ui/sidebar"
import { Clapperboard, Compass, Heart, List, TrendingUp, Tv } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

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
    {
        title: "Movies",
        url: "/movie",
        icon: Clapperboard,
    },
    {
        title: "TV Shows",
        url: "/tv",
        icon: Tv,
    },
]

const MyMovieItems = [
    {
        title: "Watchlist",
        url: "/watchlist",
        icon: List
    },
    {
        title: "Favorites",
        url: "/favorites",
        icon: Heart
    }
]

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
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
                <SidebarGroup>
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
                </SidebarGroup>
            </SidebarContent>
            <SidebarFooter />
        </Sidebar>
    )
}
