import { FC } from "react";
import { MediaVideos } from "../../hooks/useMediaVideos";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Play } from "lucide-react";
import Image from "next/image";
import { formatDate } from "date-fns";
import VideoCardDialog from "./VideoCardDialog";

interface VideoCardProps {
    data: MediaVideos["results"][number];
}

const VideoCard: FC<VideoCardProps> = ({ data }) => {
    return (
        <div className="flex flex-col gap-4">
            <Dialog key={data.id}>
                <DialogTrigger className="relative">
                    <div className="absolute p-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-950/80 top-1/2 left-1/2 text-slate-100">
                        <Play fill="currentColor" size={36} />
                    </div>
                    <Image
                        alt={data.name}
                        width={480}
                        height={360}
                        className="object-cover w-full h-full rounded-lg"
                        src={`https://img.youtube.com/vi/${data.key}/hqdefault.jpg`}
                    />
                </DialogTrigger>
                <VideoCardDialog videoKey={data.key} videoName={data.name} />
            </Dialog>
            <div className="flex flex-wrap items-center justify-between px-2 py-2">
                <h1 className="text-lg font-semibold leading-snug">{data.name}</h1>
                <span className="text-sm text-muted-foreground">
                    {formatDate(new Date(data.published_at), "MMM dd, yyyy")}
                </span>
            </div>
        </div>
    );
};

export default VideoCard;