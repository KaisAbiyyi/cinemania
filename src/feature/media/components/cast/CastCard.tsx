import { FC } from "react";
import { MediaCredits } from "../../hooks/useMediaCredits";
import Image from "next/image";
import Link from "next/link";
import { getProfileImageUrl, slugify } from "@/lib/utils";

type CastCardProps = | {
    data: MediaCredits["cast"][number] | MediaCredits["crew"][number];
    mediaType: "movie";
} | {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: any;
    mediaType: "tv";
}

const CastCard: FC<CastCardProps> = ({ data, mediaType }) => {


    return (
        <div className="relative flex w-full gap-4 overflow-hidden rounded-lg md:gap-6">
            <Link href={`/person/${data.id}-${slugify(data.name as string)}`}>
                <Image
                    width={96}
                    height={128}
                    src={getProfileImageUrl(data.profile_path as string)}
                    className="object-cover w-1/3 h-24 transition duration-300 rounded-md hover:brightness-75"
                    alt={data.name}
                    style={{ width: "96px", height: "128px", objectFit: "cover" }}
                />

            </Link>
            <div className="flex flex-col justify-center w-2/3">
                <Link href={`/person/${data.id}-${slugify(data.name as string)}`} className="text-sm font-bold hover:underline lg:text-base">
                    <h4>{data.name}</h4>
                </Link>
                {mediaType === "tv" && Array.isArray(data.roles) ? (
                    <p className="text-xs text-secondary-foreground/70 lg:text-sm">
                        {data.roles.length > 0
                            ? data.roles
                                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                .map((role: any) => `${role.character}${role.voice ? " (voice)" : ""} (${role.episode_count} episodes)`)
                                .join(", ")
                            : "No roles available"}
                    </p>
                ) : (
                    <p className="text-xs text-secondary-foreground/70 lg:text-sm">
                        {data.character || data.job || "Creator"}
                    </p>
                )}
            </div>
        </div>
    );
}

export default CastCard;