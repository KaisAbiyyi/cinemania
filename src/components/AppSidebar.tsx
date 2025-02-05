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
import { Clapperboard, Compass, Heart, Icon, List, TrendingUp, Tv } from "lucide-react"
import { title } from "process"

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
    return (
        <Sidebar collapsible="icon">
            <SidebarHeader />
            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupLabel>Browse</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {BrowseItems.map((item) => (
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
