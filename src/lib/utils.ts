import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDurationFromMinutes(durationInMinutes: number) {
  const hours = Math.floor(durationInMinutes / 60);
  const minutes = durationInMinutes % 60;

  let formattedDuration = '';

  if (hours > 0) {
    formattedDuration += `${hours}h`;
  }

  if (minutes > 0) {
    if (formattedDuration !== '') {
      formattedDuration += ' ';
    }
    formattedDuration += `${minutes}min`;
  }

  return formattedDuration.trim();
}

