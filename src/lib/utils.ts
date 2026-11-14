import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { Filters } from "@/types/filters";
import { filterFieldTypes } from "./filterMeta";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRuntime(runtime: number): string {
  if (!runtime || runtime <= 0) return 'N/A';

  const hours = Math.floor(runtime / 60);
  const minutes = runtime % 60;

  return minutes > 0 ? `${hours}h ${minutes}min` : `${hours}h`;
}



export function parseQuery(queryString: string): Partial<Filters> {
  const params = new URLSearchParams(queryString);
  const result: Partial<Filters> = {};

  params.forEach((value, key) => {
    const fieldKey = key as keyof Filters;
    const fieldType = filterFieldTypes[fieldKey];

    if (fieldType === "number") {
      const num = Number(value);
      if (!isNaN(num)) {
        result[fieldKey] = num as Filters[typeof fieldKey];;
      }
    } else {
      result[fieldKey] = value as Filters[typeof fieldKey];
    }
  });

  return result;
}

export function getInitials(name?: string | null) {
  if (!name) return "";
  // Memisahkan nama menjadi array berdasarkan spasi
  const nameArray = name.trim().split(/\s+/);
  // Mengambil huruf pertama dari setiap kata dan menggabungkannya
  const initials = nameArray.map(word => word.charAt(0).toUpperCase()).join('');
  return initials;
}

const DEFAULT_TMDB_POSTER_BASE = "https://image.tmdb.org/t/p";

export function getProfileImageUrl(profilePath?: string | null) {
  const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL || DEFAULT_TMDB_POSTER_BASE;
  const baseImageUrl = `${imagePath}/w200`;

  if (!profilePath) {
    return "/placeholder.jpg";
  }
  const normalizedPath = profilePath.startsWith("/") ? profilePath : `/${profilePath}`;
  return `${baseImageUrl}${normalizedPath}`;
}

export function getPosterImageUrl(posterPath?: string | null) {
  const imagePath = process.env.NEXT_PUBLIC_TMDB_POSTER_URL || DEFAULT_TMDB_POSTER_BASE;
  const baseImageUrl = `${imagePath}/w500`;

  if (!posterPath) {
    return "/placeholder.jpg";
  }
  const normalizedPath = posterPath.startsWith("/") ? posterPath : `/${posterPath}`;
  return `${baseImageUrl}${normalizedPath}`;
}


export function slugToTitle(slug: string): string {
  // Menghapus numeric prefix misalnya "950387-a-minecraft-movie" => "a-minecraft-movie"
  const withoutId = slug.replace(/^\d+-/, '');
  // Mengganti tanda hubung dengan spasi
  const withSpaces = withoutId.replace(/-/g, ' ');
  // Mengubah setiap kata menjadi title case (huruf awal kapital)
  return withSpaces
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const slugify = (name: string): string =>
  name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");

export function formatDuration(isoDuration: string | undefined): string {
  if (!isoDuration) return "N/A";

  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "N/A";

  const [, hours, minutes, seconds] = match.map((val) => parseInt(val || "0"));
  const parts = [];
  if (hours) parts.push(String(hours).padStart(2, "0"));
  parts.push(String(minutes).padStart(2, "0"));
  parts.push(String(seconds).padStart(2, "0"));
  return parts.join(":");
}

export function formatViewCount(viewCount: string | number): string {
  const num = typeof viewCount === "string" ? parseInt(viewCount) : viewCount;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return `${num}`;
}