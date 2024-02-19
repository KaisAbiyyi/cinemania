import { format } from "date-fns";
import { Star } from "lucide-react";
import { FC, Fragment, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";

interface ReviewOverviewProps {
    Reviews: any
}

const ReviewOverview: FC<ReviewOverviewProps> = ({ Reviews }) => {
    const imageUrl = import.meta.env.VITE_TMDB_POSTER_URL
    const { pathname } = useLocation()

    const LatestReview = Reviews.results.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]
    const paragraphs: string[] = LatestReview.content.split('\r\n');
    const maxWords: number = 75;
    let content: string[] = [];
    let wordCount = 0;
    let remainingContent = '';

    for (let i = 0; i < paragraphs.length; i++) {
        const words: string[] = paragraphs[i].trim().split(/\s+/);
        if (wordCount < maxWords) {
            if (wordCount + words.length <= maxWords) {
                content.push(paragraphs[i]);
                wordCount += words.length;
            } else {
                const remainingWords: number = maxWords - wordCount;
                const truncatedParagraph: string = words.slice(0, remainingWords).join(' ');
                content.push(truncatedParagraph);
                remainingContent = words.slice(remainingWords).join(' ');
                wordCount = maxWords;
            }
        }
    }

    console.log(content)

    return (
        <Card className="flex flex-col gap-8 p-8 mb-8 border-none bg-background">
            <CardHeader className="flex flex-row items-center justify-between p-0">
                <div className="flex items-center gap-4">
                    <CardTitle className="text-lg">Reviews</CardTitle>
                    <CardDescription></CardDescription>
                </div>
                <Link to={`${pathname}/reviews`} className="p-2 px-4 text-base font-semibold duration-200 ease-out rounded-full hover:text-primary-foreground hover:bg-primary">Read All Reviews</Link>
            </CardHeader>
            <CardContent className="border shadow-sm bg-secondary/70 rounded-xl ">
                <CardHeader className="flex flex-row items-center gap-4 px-0">
                    <Avatar className="p-0 m-0">
                        <AvatarImage src={`${imageUrl}/w500/${LatestReview.author_details.avatar_path}`} />
                        <AvatarFallback>{(LatestReview.author_details.username[0] as string).toUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-2">
                        <CardTitle className="text-base">a Review by {(LatestReview.author_details.name as string).length > 0 ? LatestReview.author_details.name : LatestReview.author_details.username}</CardTitle>
                        <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full fill-primary-foreground bg-primary text-primary-foreground">
                                <Star fill="fill-inherit" size={12} />
                                <span>{(LatestReview.author_details.rating as number).toFixed(1)}</span>
                            </div>
                            <CardDescription>Written by {LatestReview.author_details.username} on {format(new Date(LatestReview.created_at), "MMMM d, yyyy")}</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 p-0">
                    {content.map((p: string, index: number, array) => (
                        <div key={index} className="flex flex-wrap gap-1">
                            {p.split(/\s+/).map((word, wordIndex, wordsArray) => (
                                <Fragment key={wordIndex}>
                                    <p dangerouslySetInnerHTML={{ __html: word }} />
                                    {wordIndex !== wordsArray.length - 1 && ' '} {/* Add a space after each word except for the last word */}
                                </Fragment>
                            ))}
                            {index === array.length - 1 && wordCount >= maxWords && (
                                <span>
                                    {'...'} {/* Add a space before the "Read more" link */}
                                    <Link to={``} className="underline text-primary hover:text-primary/50">Read more</Link>
                                </span>
                            )}
                        </div>
                    ))}
                </CardContent>
            </CardContent>
        </Card>
    );
}

export default ReviewOverview;