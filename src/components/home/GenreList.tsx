import { FC } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "../ui/button";
import { CardTitle } from "../ui/card";

interface GenreListProps {
    data: any;
}

const GenreList: FC<GenreListProps> = ({ data }) => {
    return (
        <div className="flex flex-col gap-12 px-9">
            <CardTitle>Genres</CardTitle>
            <div className="flex flex-wrap gap-4">
                {data?.MovieGenre?.genres?.map((item: any) => (
                    <Link
                        to={`/genre/${item.id}-${(item.name as string)
                            .replace(/ /g, "-")
                            .toLowerCase()}/movie`}
                        className={buttonVariants({
                            variant: "secondary",
                            size: "lg",
                        })}
                        key={item.id}
                    >
                        {item.name}
                    </Link>
                ))}
                {data?.TVGenre?.genres?.map((item: any) => (
                    <Link
                        to={`/genre/${item.id}-${(item.name as string)
                            .replace(/ /g, "-")
                            .toLowerCase()}/tv`}
                        className={buttonVariants({
                            variant: "secondary",
                            size: "lg",
                        })}
                        key={item.id}
                    >
                        {item.name}
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default GenreList;
