"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "../lib/googleMaps";

export type PlaceValue = {
  formattedAddress: string;
  placeId?: string;
  lat?: number;
  lng?: number;
};

export default function PlacesAutocompleteInput({
  value,
  onChange,
  placeholder = "Start typing an address…",
}: {
  value: string;
  onChange: (val: string, place?: PlaceValue) => void;
  placeholder?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      console.error("Missing NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
      return;
    }

    let autocomplete: google.maps.places.Autocomplete | null = null;

    loadGoogleMaps(apiKey)
      .then(() => {
        if (!inputRef.current) return;

        autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          fields: ["formatted_address", "place_id", "geometry"],
          types: ["address"],
        });

        autocomplete.addListener("place_changed", () => {
          const place = autocomplete!.getPlace();

          const formattedAddress =
            place.formatted_address ?? inputRef.current!.value;

          onChange(formattedAddress, {
            formattedAddress,
            placeId: place.place_id,
            lat: place.geometry?.location?.lat(),
            lng: place.geometry?.location?.lng(),
          });
        });

        setReady(true);
      })
      .catch((e) => console.error("Google Maps load error", e));

    return () => {
      autocomplete = null;
    };
  }, [onChange]);

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={!ready && !value}
      style={{
        padding: 10,
        borderRadius: 10,
        border: "1px solid #ddd",
        width: "100%",
      }}
    />
  );
}
