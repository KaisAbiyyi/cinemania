import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import Navbar from "./components/Navbar";
import Sidebar from "./components/Sidebar";

interface LayoutProps {
    children: ReactNode
}

const Layout = ({ children }: LayoutProps) => {
    const queryClient = new QueryClient()

    return (
        <html lang="en">
            <body className="dark scroll-smooth">
                <QueryClientProvider client={queryClient}>
                    <div className="flex h-screen overflow-y-scroll scrollbar-thin scrollbar-track-transparent scrollbar-thumb-primary">
                        <div className="w-1/6" />
                        <Sidebar />
                        <div className="flex flex-col flex-grow w-5/6 ">
                            <Navbar />
                            <div className="flex-grow ">
                                {children}
                            </div>
                        </div>
                    </div>
                </QueryClientProvider>
            </body>
        </html>
    )
}

export default Layout