import { parseISO, format } from "date-fns";

/**
 * Format tanggal dari string ISO ke format "MMM dd, yyyy" (contoh: "Jan 01, 2024").
 * @param {string} dateString - Tanggal dalam format ISO (YYYY-MM-DD).
 * @returns {string} - Tanggal yang sudah diformat atau "Unknown Date" jika tidak valid.
 */
export const formatDate = (dateString?: string): string => {
    if (!dateString) return "Unknown Date";
    try {
        const date = parseISO(dateString);
        return !isNaN(date.getTime()) ? format(date, "MMM dd, yyyy") : "Unknown Date";
    } catch {
        return "Unknown Date";
    }
};
