import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const MediaImagesWrapperSkeleton = () => {
    const tabs = [
        { type: "backdrop", title: "Backdrops", col: "lg:grid-cols-2" },
        { type: "poster", title: "Posters", col: "lg:grid-cols-3" },
    ];

    return (
        <Tabs defaultValue="backdrop" className="w-full">
            <TabsList>
                {tabs.map((tab) => (
                    <TabsTrigger key={tab.type} value={tab.type}>
                        {tab.title}
                    </TabsTrigger>
                ))}
            </TabsList>

            {tabs.map((tab) => (
                <TabsContent key={tab.type} value={tab.type}>
                    <div className={`grid grid-cols-2 gap-4 ${tab.col}`}>
                        {[...Array(6)].map((_, idx) => (
                            <Skeleton
                                key={idx}
                                className="w-full h-[200px] rounded-lg"
                            />
                        ))}
                    </div>
                </TabsContent>
            ))}
        </Tabs>
    );
};

export default MediaImagesWrapperSkeleton
