import { FC } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "../ui/button";

interface GenreListProps {
    data: any;
}

const GenreList: FC<GenreListProps> = ({ data }) => {
    return (
        <div className="flex flex-col gap-12 px-9">
            <div className="flex gap-4 pb-[20px] overflow-x-scroll hover:-mb-[11px] scrollbar-none hover:scrollbar-thin">
                {data?.MovieGenre?.genres?.map((item: any) => (
                    <Link
                        to={`/genre/${item.id}-${(item.name as string)
                            .replace(/ /g, "-")
                            .toLowerCase()}/movie`}
                        className={buttonVariants({
                            variant: "secondary",
                            size: "lg",
                            className:"relative group"
                        })}
                        key={item.id}
                    >
                        <span className="absolute text-4xl font-bold duration-100 opacity-0 group-hover:opacity-15">MV</span>
                        <span className="z-10 uppercase">{item.name}</span>
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
                            className:"relative group"
                        })}
                        key={item.id}
                    >
                        <span className="absolute text-4xl font-bold duration-100 opacity-0 group-hover:opacity-15">TV</span>
                        <span className="z-10 uppercase">{item.name}</span>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default GenreList;
