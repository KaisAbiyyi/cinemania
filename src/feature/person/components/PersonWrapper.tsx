"use client"

import MediaDetailImagesSkeleton from '@/feature/media/components/skeletons/MediaDetailImagesSkeleton';
import dynamic from 'next/dynamic';
import { FC, Suspense } from 'react';
import { usePerson } from '../hooks/usePerson';
import { usePersonCombinedCredits } from '../hooks/usePersonCombinedCredits';
import PersonBanner from './PersonBanner';
import PersonCreditsSkeleton from './skeletons/PersonCreditsSkeleton';
import ErrorState from '@/components/ErrorState';
import PersonWrapperSkeleton from './skeletons/PersonWrapperSkeleton';
interface Props {
    // Define any props you need here
    // For example, if you want to pass a personId or other data
    personId: number;
    // Add more props as needed
}

const DetailImages = dynamic(() => import("../../../components/DetailImages"), {
    ssr: false,
});

const PersonCredits = dynamic(() => import("./PersonCredits"), {
    ssr: false
})

const PersonWrapper: FC<Props> = ({ personId }) => {
    const { data: PersonDetail, isLoading: PersonDetailLoading, error: PersonDetailError } = usePerson({ id: personId });
    const { data: PersonCombinedCredits, isLoading: PersonCombinedCreditsLoading, error: PersonCombinedCreditsError } = usePersonCombinedCredits({ id: personId })

    if (PersonDetailLoading || PersonCombinedCreditsLoading) {
        return <PersonWrapperSkeleton />;
    }
    if ((PersonDetailError || PersonCombinedCreditsError) || (!PersonDetail || !PersonCombinedCredits)) {
        return (
            <ErrorState
                message={PersonDetailError?.message || PersonCombinedCreditsError?.message || "There was an error loading the data."}
                onRetry={() => window.location.reload()}
            />
        );
    }

    return (
        <div className='flex flex-col gap-4 md:gap-6 lg:gap-8'>
            <PersonBanner personCastData={PersonCombinedCredits.cast} data={PersonDetail} />
            <div className="flex justify-end gap-4">
                <div className="hidden w-3/12 lg:block"></div>
                <div className="flex flex-col w-full gap-4 lg:w-9/12 md:gap-6 lg:gap-8">
                    <Suspense fallback={<MediaDetailImagesSkeleton />}>
                        <DetailImages
                            id={personId}
                            type="person"
                        />
                    </Suspense>
                    <Suspense fallback={<PersonCreditsSkeleton />}>
                        <PersonCredits data={PersonCombinedCredits} />
                    </Suspense>
                </div>
            </div>
        </div>
    );
};

export default PersonWrapper;