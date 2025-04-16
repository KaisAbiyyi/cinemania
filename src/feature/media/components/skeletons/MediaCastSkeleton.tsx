import { FC } from "react";

const MediaCastSkeleton: FC = () => {
    return (
        <div className="flex flex-col gap-6">
            <div className="w-1/3 h-6 bg-gray-300 animate-pulse" />
            <div className="grid grid-cols-2 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                    <div key={index} className="w-full h-24 bg-gray-300 animate-pulse" />
                ))}
            </div>
        </div>
    );
};

export default MediaCastSkeleton;