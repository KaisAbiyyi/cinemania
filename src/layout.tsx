import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { ThemeProvider } from "./components/providers/theme-provider";
import Sidebar from "./components/Sidebar";
import Navbar from "./components/Navbar";

interface LayoutProps {
    children: ReactNode
}

const Layout = ({ children }: LayoutProps) => {
    const queryClient = new QueryClient()

    return (
        <html lang="en">
            <ThemeProvider defaultTheme="system" storageKey="cinemania-ui-theme">
                <body>
                    <QueryClientProvider client={queryClient}>
                        <div className="flex min-h-screen">
                            <Sidebar />
                            <div className="flex flex-col w-5/6">
                                <Navbar />
                                <div className="p-4 flex-grow">
                                    {children}
                                </div>
                            </div>
                        </div>
                    </QueryClientProvider>
                </body>
            </ThemeProvider>
        </html>
    )
}

export default Layout