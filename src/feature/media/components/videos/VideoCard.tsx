import { FC } from "react";
import { MediaVideos } from "../../hooks/useMediaVideos";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Play } from "lucide-react";
import Image from "next/image";
import { formatDate } from "date-fns";

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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{data.name}</DialogTitle>
                        <iframe
                            className="self-stretch w-full mt-4 aspect-video"
                            src={`https://www.youtube.com/embed/${data.key}`}
                            frameBorder={0}
                            title={data.name}
                            allowFullScreen
                            aria-hidden="true"
                        />
                    </DialogHeader>
                </DialogContent>
            </Dialog>
            <div className="flex justify-between gap-2 px-2">
                <h1 className="text-lg font-bold">{data.name}</h1>
                <p className="text-sm text-muted-foreground">{formatDate(new Date(data.published_at), "MMMM dd, yyyy")}</p>
            </div>
        </div>
    );
}

export default VideoCard;