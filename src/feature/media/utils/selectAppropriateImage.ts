import { MediaImages } from "../hooks/useMediaImages";
import { PersonImages } from "../../person/hooks/usePersonImages";

// Helper function to determine image size classes based on index
export function getImageSizeClasses(index: number): string {
    // Mobile screens - single column layout
    const mobileClass = "col-span-1";

    // Tablet and above screen layout (6-column grid system)
    let tabletClass = "";

    // Different layouts for different screen widths
    switch (index) {
        case 0: // Featured image - large left
            tabletClass = "sm:col-span-3 sm:row-span-2";
            break;
        case 1: // Top right image
            tabletClass = "sm:col-span-3";
            break;
        case 2: // Small right image
            tabletClass = "sm:col-span-2";
            break;
        case 3: // Small right image
            tabletClass = "sm:col-span-1 sm:row-span-1";
            break;
        case 4: // Left middle image
            tabletClass = "sm:col-span-2";
            break;
        case 5: // Middle image
            tabletClass = "sm:col-span-2";
            break;
        case 6: // Wide bottom right image
            tabletClass = "sm:col-span-2";
            break;
        case 7: // Bottom wide
            tabletClass = "sm:col-span-3";
            break;
        case 8: // Bottom wide
            tabletClass = "sm:col-span-3";
            break;
        default:
            tabletClass = "sm:col-span-2";
            break;
    }

    return `${mobileClass} ${tabletClass}`;
}

// Helper function to select appropriate images for each position
export function selectAppropriateImages(
    backdrops: MediaImages["posters"] = [],
    posters: MediaImages["posters"] = [],
    profiles: PersonImages["profiles"] = []
): MediaImages["posters"] | PersonImages["profiles"] {
    // Combine all images into a single array if profiles are provided (for person)
    const allImages = profiles.length > 0 ? profiles : [...backdrops, ...posters];

    // Sort by vote_average or popularity to get the best images first
    const sortedImages = [...allImages].sort((a, b) =>
        ((b.vote_average || b.popularity || 0) - (a.vote_average || a.popularity || 0))
    );

    // Limit to 9 images or less
    return sortedImages.slice(0, 9);
}