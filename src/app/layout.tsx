"use client";

import Footer from "@/components/layout/Footer";
import Navbar from "@/components/layout/navbar/Navbar";
import { AppSidebar } from "@/components/layout/Sidebar";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Geist, Geist_Mono } from "next/font/google";
import { Suspense, useMemo } from "react";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});


function MainContent({ children }: { children: React.ReactNode }) {
  const { state, isMobile } = useSidebar();

  const sidebarWidth =
    state === "collapsed" ? "var(--sidebar-width-icon)" : "var(--sidebar-width)";

  const mainStyle = isMobile
    ? { left: 0, width: "100%" }
    : { left: sidebarWidth, transition: "left 0.2s ease, width 0.2s ease" };

  return (
    <main
      style={mainStyle}
      className="absolute top-0 bottom-0 right-0 flex flex-col overflow-y-auto scrollbar-thin scrollbar-thumb-primary scrollbar-track-rounded-full scrollbar-thumb-rounded-full scrollbar-corner-rounded scrollbar-w-3 scrollbar-track-transparent"
    >
      <Navbar />
      <div className="flex flex-col gap-10 p-4 transition-all duration-100 ease-in md:p-6 lg:p-8 xl:p-10">{children}</div>
      <Footer />
    </main>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const queryClient = useMemo(() => new QueryClient(), []);

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider attribute="class" defaultTheme="light">
          <QueryClientProvider client={queryClient}>
            <SidebarProvider>
              <div className="relative w-full h-svh bg-gradient-to-tl from-transparent dark:from-black via-background to-primary/5">
                <AppSidebar />
                <MainContent>
                  <Suspense fallback={null}>
                    {children}
                  </Suspense>
                </MainContent>
              </div>
            </SidebarProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
