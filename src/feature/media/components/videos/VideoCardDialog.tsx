import { FC } from "react";
import { DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useYoutube } from "@/feature/youtube/hooks/useYoutube";
import { CalendarDays, Clock, Eye } from "lucide-react";
import { formatDuration, formatViewCount } from "@/lib/utils";
import { formatDate } from "date-fns";

interface VideoCardDialogProps {
    videoKey: string;
    videoName: string;
}

const VideoCardDialog: FC<VideoCardDialogProps> = ({ videoKey, videoName }) => {
    const { data: youtubeData, isLoading, error } = useYoutube(videoKey);

    return (
        <DialogContent>
            <DialogHeader>
                <DialogTitle>{videoName}</DialogTitle>
                <iframe
                    className="self-stretch w-full mt-4 aspect-video"
                    src={`https://www.youtube.com/embed/${videoKey}`}
                    frameBorder={0}
                    title={videoName}
                    allowFullScreen
                    aria-hidden="true"
                />
                {isLoading && <p className="mt-2 text-sm text-muted-foreground">Loading video details...</p>}
                {error && <p className="mt-2 text-sm text-red-500">Failed to load video details</p>}
                {youtubeData && (
                    <div className="flex justify-between gap-3 px-2 py-2">

                        <div className="flex flex-wrap items-center justify-between text-sm text-muted-foreground">
                            <p className="font-medium capitalize">{youtubeData?.channelTitle || "Unknown Channel"}</p>


                        </div>

                        <div className="flex items-center gap-4 text-xs text-secondary-foreground">
                            <div className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                <span>{formatDuration(youtubeData?.duration)}</span>
                            </div>

                            {youtubeData?.viewCount && (
                                <div className="flex items-center gap-1">
                                    <Eye className="w-4 h-4" />
                                    <span>{formatViewCount(youtubeData.viewCount)} views</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </DialogHeader>
        </DialogContent>
    );
};

export default VideoCardDialog;
