"use client";

import { FcGoogle } from "react-icons/fc";
import { Button } from "../../../components/ui/button";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

export default function GoogleAuthBtn() {
	// Server-side OAuth flow: hand the whole browser to the backend, which
	// redirects on to Google and, after consent, back to /auth/google/callback
	// with a token. A plain navigation (not fetch) is required so the browser
	// follows Google's redirects.
	const onClick = () => {
		window.location.href = `${API_URL}/api/auth/google/redirect`;
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
