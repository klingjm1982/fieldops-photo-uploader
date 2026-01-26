let googleMapsPromise: Promise<void> | null = null;

export function loadGoogleMaps(apiKey: string) {
  if (typeof window === "undefined") return Promise.resolve();

  if ((window as any).google?.maps?.places) return Promise.resolve();

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places`;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Maps failed to load"));
      document.head.appendChild(script);
    });
  }

  return googleMapsPromise;
}
