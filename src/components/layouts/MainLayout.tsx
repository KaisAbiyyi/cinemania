import { useMemo } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { HelmetProvider } from "react-helmet-async"
import { ThemeProvider } from "./theme-provider"
import { useSidebar, SidebarProvider } from "@/components/ui/sidebar"
import Navbar from "./Navbar"
import { AppSidebar } from "./AppSidebar"

function MainContent({ children }: { children: React.ReactNode }) {
  const { state } = useSidebar()

  // Tentukan lebar sidebar sesuai state:
  // Jika collapsed: gunakan var(--sidebar-width-icon) misalnya "3rem"
  // Jika expanded: gunakan var(--sidebar-width) misalnya "16rem"
  const sidebarWidth =
    state === "collapsed" ? "var(--sidebar-width-icon)" : "var(--sidebar-width)"

  // Dengan menggunakan absolute positioning dan right: 0,
  // kita mengatur left sesuai lebar sidebar, sehingga main content
  // akan selalu menempel ke sisi kanan.
  const mainStyle = {
    position: "absolute" as const,
    top: 0,
    bottom: 0,
    right: 0,
    left: sidebarWidth,
    transition: "left 0.2s ease, width 0.2s ease",
  }

  return (
    <main style={mainStyle} className="flex flex-col overflow-y-auto scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent">
      <Navbar />
      <div className="flex flex-col gap-10 p-8">
        {children}
      </div>
    </main>
  )
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), [])

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SidebarProvider>
          <HelmetProvider>
            {/* Bungkus AppSidebar dan MainContent dalam container relative agar absolute positioning berfungsi */}
            <div className="relative w-full h-svh">
              <AppSidebar />
              <MainContent>{children}</MainContent>
            </div>
          </HelmetProvider>
        </SidebarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
