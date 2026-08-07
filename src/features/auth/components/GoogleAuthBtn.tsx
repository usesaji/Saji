"use client";

import { FcGoogle } from "react-icons/fc";
import { Button } from "../../../components/ui/button";

import { auth } from "../../../lib/api";

export default function GoogleAuthBtn() {
	// Server-side OAuth flow: hand the whole browser to the API, which redirects
	// on to Google and, after consent, back to /auth/google/callback with a
	// token. A plain navigation (not fetch) is required so the browser follows
	// Google's redirects.
	//
	// The URL comes from the api client rather than a second copy of the base
	// URL here — a local copy silently drifts from the real one.
	const onClick = () => {
		window.location.href = auth.googleRedirectUrl();
	};

	return (
		<Button
			onClick={onClick}
			type="button"
			className="w-full bg-[#f5f5f5] text-black-500 font-normal hover:bg-neutral-100 "
		>
			<FcGoogle size={22} />
			<span>Continue with Google</span>
		</Button>
	);
}
