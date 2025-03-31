"use client";

import React, { FC, useState, useMemo, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useProviderRegions } from "@/feature/providers/hooks/useProviderRegions";
import { useProviderMedia } from "@/feature/providers/hooks/useProviderMedia";
import { useGeolocation } from "@/feature/geolocation/hooks/useGeolocation";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command,
    CommandInput,
    CommandList,
    CommandGroup,
    CommandItem,
    CommandEmpty,
} from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface WatchProvidersFilterProps {
    mediaType: "movie" | "tv";
    initialWatchRegion?: string; // misal "US"
    initialProviders?: string;   // CSV provider IDs, misal "8,119"
    onChange?: (watch_region: string, with_watch_providers: string) => void;
}

const WatchProvidersFilter: FC<WatchProvidersFilterProps> = ({
    mediaType,
    initialWatchRegion = "US",
    initialProviders = "",
    onChange,
}) => {
    // State untuk region dan provider
    const [selectedRegion, setSelectedRegion] = useState(initialWatchRegion);
    const [regionQuery, setRegionQuery] = useState("");
    const [selectedProviders, setSelectedProviders] = useState<number[]>([]);

    // Sinkronisasi state dengan prop: jika initialWatchRegion berubah, update selectedRegion
    useEffect(() => {
        setSelectedRegion(initialWatchRegion || "US");
    }, [initialWatchRegion]);

    // Gunakan hook useGeolocation untuk mendapatkan region berdasarkan IP
    const { data: geoData } = useGeolocation();
    useEffect(() => {
        if (geoData?.region && (selectedRegion === "US" || !selectedRegion)) {
            setSelectedRegion(geoData.region);
        }
    }, [geoData, selectedRegion]);

    // Sinkronisasi state provider dengan prop initialProviders
    useEffect(() => {
        if (initialProviders) {
            const ids = initialProviders.split("|").filter(Boolean).map(Number);
            setSelectedProviders(ids);
        } else {
            setSelectedProviders([]);
        }
    }, [initialProviders]);

    // Ambil daftar region dengan bahasa "en-US"
    const { data: regionData, isLoading: isLoadingRegions, error: errorRegions } = useProviderRegions("en-US");
    const regions = regionData?.results || [];

    // Filter regions berdasarkan query
    const filteredRegions = useMemo(() => {
        if (!regions) return [];
        const q = regionQuery.toLowerCase().trim();
        if (!q) return regions;
        return regions.filter((r) => {
            const englishName = r.english_name.toLowerCase();
            const nativeName = r.native_name?.toLowerCase() || "";
            const iso = r.iso_3166_1.toLowerCase();
            return (
                englishName.includes(q) ||
                nativeName.includes(q) ||
                iso.includes(q)
            );
        });
    }, [regions, regionQuery]);

    // Ambil daftar provider berdasarkan mediaType, bahasa "en-US", dan selectedRegion
    const { data: providerData, isLoading: isLoadingProviders, error: errorProviders } = useProviderMedia(
        mediaType,
        "en-US",
        selectedRegion
    );
    const providers = providerData?.results || [];

    // Handler untuk memilih region dari daftar
    const handleSelectRegion = (iso: string) => {
        setSelectedRegion(iso);
        setRegionQuery("");
    };

    // Toggle provider selection
    const toggleProvider = (providerId: number) => {
        let updated: number[];
        if (selectedProviders.includes(providerId)) {
            updated = selectedProviders.filter((id) => id !== providerId);
        } else {
            updated = [...selectedProviders, providerId];
        }
        setSelectedProviders(updated);
    };

    // Ref untuk mencegah pemanggilan onChange berulang jika tidak ada perubahan
    const prevValuesRef = useRef({
        region: selectedRegion,
        providers: selectedProviders.join("|"),
    });

    useEffect(() => {
        const currentRegion = selectedRegion;
        const currentProviders = selectedProviders.join("|");
        if (
            currentRegion !== prevValuesRef.current.region ||
            currentProviders !== prevValuesRef.current.providers
        ) {
            prevValuesRef.current = { region: currentRegion, providers: currentProviders };
            onChange?.(currentRegion, currentProviders);
        }
    }, [selectedRegion, selectedProviders, onChange]);

    // State untuk mengendalikan Popover pada region select
    const [openRegion, setOpenRegion] = useState(false);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
                <Label>Country</Label>
                <Popover open={openRegion} onOpenChange={setOpenRegion}>
                    <PopoverTrigger asChild>
                        <Button variant="outline" role="combobox" className="justify-between">
                            {selectedRegion || "US"}
                            <ChevronsUpDown className="opacity-50" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0" align="start">
                        <Command>
                            <CommandInput
                                placeholder="Search country..."
                                value={regionQuery}
                                onValueChange={setRegionQuery}
                            />
                            <CommandList>
                                {isLoadingRegions && <CommandEmpty>Loading...</CommandEmpty>}
                                {errorRegions && <CommandEmpty>Error loading regions</CommandEmpty>}
                                {!isLoadingRegions && filteredRegions.length === 0 && (
                                    <CommandEmpty>No region found.</CommandEmpty>
                                )}
                                <CommandGroup>
                                    {filteredRegions.map((r) => (
                                        <CommandItem
                                            key={r.iso_3166_1}
                                            value={r.english_name}
                                            onSelect={() => handleSelectRegion(r.iso_3166_1)}
                                        >
                                            {r.english_name} ({r.iso_3166_1})
                                            <Check
                                                className={cn(
                                                    "ml-auto",
                                                    selectedRegion === r.iso_3166_1 ? "opacity-100" : "opacity-0"
                                                )}
                                            />
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            </CommandList>
                        </Command>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Provider Selection */}
            <div className="flex flex-col gap-2">
                <Label>Providers</Label>
                <div className="flex flex-wrap gap-2">
                    {isLoadingProviders && <p>Loading providers...</p>}
                    {errorProviders && <p>Error loading providers</p>}
                    {!isLoadingProviders && providers.length === 0 && <p>No providers found.</p>}
                    {!isLoadingProviders &&
                        providers.map((prov: any) => {
                            const { provider_id, provider_name, logo_path } = prov;
                            const isSelected = selectedProviders.includes(provider_id);
                            return (
                                <Button
                                    key={provider_id}
                                    variant={isSelected ? "default" : "outline"}
                                    className="rounded-full p-2"
                                    size="icon"
                                    onClick={() => toggleProvider(provider_id)}
                                >
                                    {logo_path ? (
                                        <img
                                            src={`https://image.tmdb.org/t/p/original${logo_path}`}
                                            alt={provider_name}
                                            className="w-8 h-8 object-contain rounded"
                                        />
                                    ) : (
                                        provider_name
                                    )}
                                </Button>
                            );
                        })}
                </div>
            </div>
        </div>
    );
};

export default WatchProvidersFilter;
