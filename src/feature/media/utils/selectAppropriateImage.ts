import { MediaImages } from "../hooks/useMediaImages";

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
export function selectAppropriateImages(backdrops: MediaImages["posters"], posters: MediaImages["posters"]): MediaImages["posters"] {
    // Sort by vote_average to get the best images first
    const sortedBackdrops = [...backdrops].sort((a, b) =>
        ((b.vote_average || 0) - (a.vote_average || 0))
    );

    const sortedPosters = [...posters].sort((a, b) =>
        ((b.vote_average || 0) - (a.vote_average || 0))
    );

    // Define position preferences (true = prefer backdrop, false = prefer poster)
    const preferBackdrop = [true, true, false, false, false, true, true, true, true];

    const result: MediaImages["posters"] = [];
    let backdropIndex = 0;
    let posterIndex = 0;

    // Limit to 9 images or less
    const maxImages = Math.min(9, sortedBackdrops.length + sortedPosters.length);

    for (let i = 0; i < maxImages; i++) {
        // For positions where we prefer backdrops
        if (preferBackdrop[i]) {
            if (backdropIndex < sortedBackdrops.length) {
                result.push(sortedBackdrops[backdropIndex++]);
            } else if (posterIndex < sortedPosters.length) {
                result.push(sortedPosters[posterIndex++]);
            }
        }
        // For positions where we prefer posters
        else {
            if (posterIndex < sortedPosters.length) {
                result.push(sortedPosters[posterIndex++]);
            } else if (backdropIndex < sortedBackdrops.length) {
                result.push(sortedBackdrops[backdropIndex++]);
            }
        }
    }

    return result;
}