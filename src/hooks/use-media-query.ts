"use client";
import { useEffect, useState } from "react";

export function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(false);

	useEffect(() => {
		const mediaQueryList = window.matchMedia(query);
		// Read the current match synchronously on mount — matchMedia is the
		// external system being synced, and useState(false) can't know its
		// value at initial render (must match SSR output before this runs).
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setMatches(mediaQueryList.matches);

		const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
		mediaQueryList.addEventListener("change", listener);
		return () => mediaQueryList.removeEventListener("change", listener);
	}, [query]);

	return matches;
}
