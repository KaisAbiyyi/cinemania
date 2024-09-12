import MainPersonCard from "@/components/person/detail/MainPersonCard";
import PersonBio from "@/components/person/detail/PersonBio";
import PersonDetailSkeleton from "@/components/person/detail/Skeletons/PersonDetailSkeleton";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Helmet } from "react-helmet";
import { useParams } from "react-router-dom";

const PersonDetail = () => {
    const { id } = useParams()
    const splittedId = ((id as string).split("-"))[0]
    const token = import.meta.env.VITE_TMDB_API_RAT

    const { data: Person, isPending: PersonPending } = useQuery({
        queryKey: [`getPersonDetail${splittedId}`],
        queryFn: async () => {
            const { data } = await axios.get(`https://api.themoviedb.org/3/person/${splittedId}?language=en-US`, { headers: { Authorization: `Bearer ${token}` } })
            return data
        }

    })


    if (PersonPending) {
        return (
            <PersonDetailSkeleton />
        )
    }



    return (
        <>
            <Helmet>
                <title>{Person.name} | Cinemania</title>
            </Helmet>
            <div className="relative flex flex-col gap-8 p-2 lg:gap-8 lg:flex-row lg:p-8">
                <MainPersonCard data={Person} className="!z-10 w-full overflow-hidden lg:w-2/4 xl:w-1/4" />
                <PersonBio data={Person} className="z-10 w-full lg:w-2/4 xl:w-3/5" />
            </div>
        </>
    );
}

export default PersonDetail;