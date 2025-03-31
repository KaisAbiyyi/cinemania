import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { Filters } from "@/types/filters";
import { filterFieldTypes } from "./filterMeta";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
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
        result[fieldKey] = num as any;
      }
    } else {
      result[fieldKey] = value as any;
    }
  });

  return result;
}