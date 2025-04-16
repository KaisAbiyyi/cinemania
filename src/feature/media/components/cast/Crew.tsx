import { FC } from "react";
import CastCard from "@/feature/media/components/cast/CastCard";

interface CrewProps {
    crew: any[];
    mediaType: "movie" | "tv";
}

const Crew: FC<CrewProps> = ({ crew, mediaType }) => {
    // Group crew members by their department
    const groupedCrew = crew.reduce<Record<string, any[]>>((acc, member) => {
        const department = member.department || "Other";
        if (!acc[department]) acc[department] = [];
        acc[department].push(member);
        return acc;
    }, {} as Record<string, any[]>);

    // Define priority order for departments
    const priorityOrder = ["Directing", "Writing", "Production"];

    // Sort departments by priority and alphabetically for others
    const sortedDepartments = Object.keys(groupedCrew).sort((a, b) => {
        const indexA = priorityOrder.indexOf(a);
        const indexB = priorityOrder.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
    });

    return (
        <div className="flex flex-col gap-8">
            <h2 className="text-lg font-bold md:text-xl lg:text-2xl xl:text-3xl">Crew</h2>
            {sortedDepartments.map((department) => (
                <div key={department} className="flex flex-col gap-2">
                    <h3 className="text-lg font-medium">{department}</h3>
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-1 lg:grid-cols-2">
                        {groupedCrew[department].map((crewMember, index) => (
                            <CastCard key={index} data={crewMember} mediaType={mediaType} />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default Crew;