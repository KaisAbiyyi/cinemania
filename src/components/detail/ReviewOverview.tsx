import { format } from "date-fns";
import { Star } from "lucide-react";
import { FC, Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { buttonVariants } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Separator } from "../ui/separator";

interface ReviewOverviewProps {
    reviews: any;
}

const truncateParagraphs = (content: string, maxWords: number) => {
    const paragraphs: string[] = content.split('\r\n');
    let truncatedContent: string[] = [];
    let wordCount = 0;

    if (paragraphs.length > 0) {
        for (let i = 0; i < paragraphs.length; i++) {
            const words: string[] = paragraphs[i].trim().split(/\s+/);
            if (wordCount < maxWords) {
                if (wordCount + words.length <= maxWords) {
                    truncatedContent.push(paragraphs[i]);
                    wordCount += words.length;
                } else {
                    const remainingWords: number = maxWords - wordCount;
                    const truncatedParagraph: string = words.slice(0, remainingWords).join(' ');
                    truncatedContent.push(truncatedParagraph);
                    wordCount = maxWords;
                }
            }
        }
    }

    return truncatedContent;
};

const ReviewOverview: FC<ReviewOverviewProps> = ({ reviews }) => {
    const imageUrl = import.meta.env.VITE_TMDB_POSTER_URL;
    const { pathname } = useLocation();

    if (reviews.results.length === 0) {
        return (
            <Card className="flex flex-col gap-8 p-0 border-none bg-background">
                <CardHeader className="flex flex-row items-center justify-between p-0">
                    <div className="flex items-center gap-4">
                        <CardTitle className="text-lg">Reviews</CardTitle>
                    </div>
                </CardHeader>
                <CardContent className="p-4 border shadow-sm bg-secondary/70 rounded-xl">We don't have any reviews for Sri Asih. Would you like to write one?</CardContent>
            </Card>
        );
    }

    const sortedReviews = reviews.results.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const latestReviews = sortedReviews.slice(0, 3);

    return (
        <Card className="flex flex-col gap-8 p-0 border-none bg-background">
            <CardHeader className="flex flex-row items-center justify-between p-0">
                <div className="flex items-center gap-4">
                    <CardTitle>Reviews</CardTitle>
                </div>
                <Link to={`${pathname}/reviews`} className={buttonVariants({ variant: "ghost" })}>Read All Reviews</Link>
            </CardHeader>
            <div className="flex flex-col gap-4 rounded-lg bg-gradient-to-b from-secondary via-secondary to-secondary/50">
                {latestReviews.map((review: any, index: number) => {
                    const truncatedContent = truncateParagraphs(review.content, 75);

                    return (
                        <>
                            <CardContent key={review.id}>
                                <CardHeader className="flex flex-row items-center gap-4 px-0">
                                    <Avatar className="p-0 m-0">
                                        <AvatarImage src={`${imageUrl}/w500/${review.author_details.avatar_path}`} />
                                        <AvatarFallback>{(review.author_details.username[0] as string).toUpperCase()}</AvatarFallback>
                                    </Avatar>
                                    <div className="flex items-start justify-between w-full gap-2">
                                        <div className="flex flex-col gap-2">
                                            <CardTitle className="flex items-center gap-2 text-base">{(review.author_details.name as string).length > 0 ? review.author_details.name : review.author_details.username} <CardDescription className="font-thin">{review.author_details.username}</CardDescription></CardTitle>
                                            <CardDescription>{format(new Date(review.created_at), "MMMM d, yyyy")}</CardDescription>
                                        </div>
                                        <div className="flex flex-col gap-2 md:items-center md:flex-row">
                                            {review.author_details.rating &&
                                                <div className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full w-fit fill-primary-foreground bg-primary text-primary-foreground">
                                                    <Star fill="fill-inherit" size={12} />
                                                    <span>{(review.author_details.rating as number).toFixed(1)}</span>
                                                </div>
                                            }
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="flex flex-col gap-2 p-0">
                                    {truncatedContent.map((p: string, index: number) => (
                                        <div key={index} className="flex flex-wrap gap-1">
                                            {p.split(/\s+/).map((word, wordIndex, wordsArray) => (
                                                <Fragment key={wordIndex}>
                                                    <p dangerouslySetInnerHTML={{ __html: word }} />
                                                    {wordIndex !== wordsArray.length - 1 && ' '} {/* Add a space after each word except for the last word */}
                                                </Fragment>
                                            ))}
                                        </div>
                                    ))}
                                </CardContent>
                            </CardContent>
                            {index < 2 &&
                                <Separator className="bg-primary-foreground/10" />
                            }
                        </>
                    );
                })}
            </div>
        </Card>
    );
}

export default ReviewOverview;
