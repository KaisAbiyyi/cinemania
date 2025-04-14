import { FC } from "react";
import { MediaCredits } from "../hooks/useMediaCredits";
import Image from "next/image";
import Link from "next/link";
import { getProfileImageUrl, slugify } from "@/lib/utils";

interface CastCardProps {
    data: MediaCredits["cast"][number] | MediaCredits["crew"][number];
}

const CastCard: FC<CastCardProps> = ({ data }) => {

    return (
        <div className="relative gap-4 md:gap-6 flex w-full overflow-hidden rounded-lg">
            <Link href={`/person/${data.id}-${slugify(data.name as string)}`}>
                <Image
                    width={96}
                    height={128}
                    src={getProfileImageUrl(data.profile_path as string)}
                    className="w-24 h-24 object-cover rounded-md transition duration-300 hover:brightness-75"
                    alt={data.name}
                />

            </Link>
            <div className="flex flex-col justify-center">
                <Link href={`/person/${data.id}-${slugify(data.name as string)}`} className="font-bold hover:underline text-sm lg:text-base">
                    <h4>{data.name}</h4>
                </Link>
                <p className="text-secondary-foreground/70 text-xs lg:text-sm">{data.character || data.job}</p>
            </div>
        </div>
    );
}

export default CastCard;