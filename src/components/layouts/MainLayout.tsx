import { SidebarProvider } from "@/components/ui/sidebar"
import { AppSidebar } from "./AppSidebar"
import Navbar from "./Navbar"
import { ThemeProvider } from "./theme-provider"
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMemo } from "react"
import { HelmetProvider } from 'react-helmet-async'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  const queryClient = useMemo(() => new QueryClient(), [])
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <SidebarProvider>
          <HelmetProvider>
            <AppSidebar />
            <main className="flex flex-col w-full md:w-[calc(100%-16rem)]">
              <Navbar />
              <div className="flex flex-col gap-8 p-8">
                {children}
              </div>
            </main>
          </HelmetProvider>
        </SidebarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
