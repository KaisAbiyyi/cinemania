import { Label } from "@/components/ui/label";
import { useLanguages } from "@/feature/languages/hooks/useLanguages";
import { FC } from "react";
import { useMediaKeywords } from "../../hooks/useMediaKeywords";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { slugify } from "@/lib/utils";
import MediaDetailAsideSkeleton from "../skeletons/MediaDetailAsideSkeleton";
import Image from "next/image";

interface MediaDetailAsideProps {
    id: number;
    mediaType: "movie" | "tv";
    detailData: any
}

const MediaDetailAside: FC<MediaDetailAsideProps> = ({ id, mediaType, detailData }) => {
    const { data: LanguageData, isLoading: LanguageLoading, error: LanguageError } = useLanguages()
    const { data: KeywordsData, isLoading: KeywordsLoading, error: KeywordsError } = useMediaKeywords({ id, mediaType })

    if (LanguageLoading || KeywordsLoading) return <MediaDetailAsideSkeleton />;
    if ((LanguageError || !LanguageData) || (KeywordsError || !KeywordsData)) return <div>Error fetching languages</div>;

    const original_language = LanguageData.find((lang: any) => lang.iso_639_1 === detailData.original_language);
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL
    console.log(detailData)

    return (
        <aside className="flex flex-col w-full gap-2 md:gap-4 md:w-1/3 lg:gap-6 xl:gap-8">
            <div className="flex flex-col gap-2">
                <Label>Status</Label>
                <p className="text-muted-foreground">{detailData.status}</p>
            </div>
            <div className="flex flex-col gap-2">
                <Label>Original Language</Label>
                <p className="text-muted-foreground">{original_language?.english_name}</p>
            </div>
            {mediaType === "movie" ? (
                <>
                    <div className="flex flex-col gap-2">
                        <Label>Budget</Label>
                        <p className="text-muted-foreground">
                            {detailData.budget ? `$${detailData.budget.toLocaleString()}` : "-"}
                        </p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label>Revenue</Label>
                        <p className="text-muted-foreground">
                            {detailData.revenue ? `$${detailData.revenue.toLocaleString()}` : "-"}
                        </p>
                    </div>
                </>
            ) : (
                <>
                    <div className="flex flex-col gap-2">
                        <Label>Network</Label>
                        <div className="flex flex-wrap items-center gap-2">
                            {detailData?.networks?.length ? (
                                detailData?.networks?.map((n: any) => (
                                    <div key={n.id} className="flex items-center gap-2">
                                        {n.logo_path && (
                                            <Image
                                                src={`${imagePath}/w500/${n.logo_path}`}
                                                alt={n.name}
                                                width={40}
                                                height={20}
                                                className="object-contain h-5"
                                            />
                                        )}
                                        <p className="text-muted-foreground">{n.name}</p>
                                    </div>
                                ))
                            ) : (
                                <p className="text-muted-foreground">-</p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Type</Label>
                        <p className="text-muted-foreground">{detailData.type || "-"}</p>
                    </div>
                </>
            )}

            <div className="flex flex-col gap-2">
                <Label>Keywords</Label>
                <div className="flex flex-wrap gap-2">
                    {KeywordsData.keywords.map((keyword: any) => (
                        <Link href={`/keyword/${keyword.id}-${slugify(keyword.name)}/${mediaType}`} key={keyword.id} className={buttonVariants({ variant: "secondary" })}>{keyword.name}</Link>
                    ))}
                </div>
            </div>
        </aside>
    );
}

export default MediaDetailAside;