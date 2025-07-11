import { Label } from "@/components/ui/label";
import { useLanguages } from "@/feature/languages/hooks/useLanguages";
import { FC } from "react";
import { useMediaKeywords } from "../../hooks/useMediaKeywords";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { slugify } from "@/lib/utils";
import MediaDetailAsideSkeleton from "../skeletons/MediaDetailAsideSkeleton";
import Image from "next/image";
import ErrorState from "@/components/ErrorState";

interface MediaDetailAsideProps {
    id: number;
    mediaType: "movie" | "tv";
    // eslint-disable-next-line
    detailData: any
}

const MediaDetailAside: FC<MediaDetailAsideProps> = ({ id, mediaType, detailData }) => {
    const { data: LanguageData, isLoading: LanguageLoading, error: LanguageError } = useLanguages()
    const { data: KeywordsData, isLoading: KeywordsLoading, error: KeywordsError } = useMediaKeywords({ id, mediaType })

    if (LanguageLoading || KeywordsLoading) return <MediaDetailAsideSkeleton />;
    if ((LanguageError || !LanguageData) || (KeywordsError || !KeywordsData)) return <ErrorState message={(LanguageError?.message || KeywordsError?.message) || "There was an error loading the data."} onRetry={() => window.location.reload()} />;
    // eslint-disable-next-line
    const original_language = LanguageData.find((lang: any) => lang.iso_639_1 === detailData.original_language);
    const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL

    return (
        <aside className="flex flex-col w-full gap-2 md:gap-4 md:w-1/3 lg:gap-6 xl:gap-8">
            <div className="flex flex-col gap-2">
                <Label>Status</Label>
                <p className="text-muted-foreground">{detailData.status || "No status available"}</p>
            </div>
            <div className="flex flex-col gap-2">
                <Label>Original Language</Label>
                <p className="text-muted-foreground">{original_language?.english_name || "No original language available"}</p>
            </div>
            {mediaType === "movie" ? (
                <>
                    <div className="flex flex-col gap-2">
                        <Label>Budget</Label>
                        <p className="text-muted-foreground">
                            {detailData.budget ? `$${detailData.budget.toLocaleString()}` : "No budget available"}
                        </p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label>Revenue</Label>
                        <p className="text-muted-foreground">
                            {detailData.revenue ? `$${detailData.revenue.toLocaleString()}` : "No revenue available"}
                        </p>
                    </div>
                </>
            ) : (
                <>
                    <div className="flex flex-col gap-2">
                        <Label>Network</Label>
                        <div className="flex flex-wrap items-center gap-2">
                            {detailData?.networks?.length ? (
                                // eslint-disable-next-line
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
                                <p className="text-muted-foreground">No networks available</p>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-2">
                        <Label>Type</Label>
                        <p className="text-muted-foreground">{detailData.type || "No type available"}</p>
                    </div>
                </>
            )}

            <div className="flex flex-col gap-2">
                <Label>Keywords</Label>
                <div className="flex flex-wrap gap-2">
                    {KeywordsData.keywords.length ? (
                        // eslint-disable-next-line
                        KeywordsData.keywords.map((keyword: any) => (
                            <Link href={`/keyword/${keyword.id}-${slugify(keyword.name)}/${mediaType}`} key={keyword.id} className={buttonVariants({ variant: "secondary" })}>{keyword.name}</Link>
                        ))
                    ) : (
                        <p className="text-muted-foreground">No keywords available</p>
                    )}
                </div>
            </div>
        </aside>
    );
}

export default MediaDetailAside;