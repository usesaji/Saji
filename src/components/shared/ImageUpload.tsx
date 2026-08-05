"use client";

/* eslint-disable @next/next/no-img-element */
import { useRef, useState } from "react";
import { HiOutlineCamera } from "react-icons/hi2";
import { toast } from "../../lib/utils/toast";
import { ApiError } from "../../lib/api";

type ImageUploadProps = {
	/** Current image URL (already resolved via assetUrl), or "" for none. */
	src: string;
	/** Placeholder shown when there's no uploaded image. */
	placeholder: string;
	/** Uploads the chosen file and resolves to the new stored URL. */
	onUpload: (file: File) => Promise<string>;
	/** "avatar" = circle, "banner" = wide rounded rectangle. */
	variant?: "avatar" | "banner";
	/** Whether the current user may change this image (e.g. group organizer). */
	editable?: boolean;
	alt?: string;
	className?: string;
};

const MAX_BYTES = 5 * 1024 * 1024; // matches backend 5 MB limit
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];

/**
 * Image with an inline upload affordance. Falls back to a placeholder when the
 * user/group hasn't uploaded a picture yet. Optimistically previews the picked
 * file while the upload is in flight, then swaps to the stored URL on success.
 */
export default function ImageUpload({
	src,
	placeholder,
	onUpload,
	variant = "avatar",
	editable = true,
	alt = "",
	className = "",
}: ImageUploadProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);

	const shown = preview ?? (src || placeholder);

	const pick = () => inputRef.current?.click();

	const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		e.target.value = ""; // allow re-selecting the same file
		if (!file) return;

		if (!ACCEPTED.includes(file.type)) {
			toast.error("Use a JPG, PNG, or WebP image.", "Unsupported file");
			return;
		}
		if (file.size > MAX_BYTES) {
			toast.error("Image must be 5 MB or smaller.", "File too large");
			return;
		}

		// Optimistic local preview while uploading.
		const localUrl = URL.createObjectURL(file);
		setPreview(localUrl);
		setUploading(true);

		try {
			const url = await onUpload(file);
			// Success: keep showing the stored image (parent state also updates).
			setPreview(url);
			toast.success("", "Image updated");
		} catch (err) {
			setPreview(null); // revert to previous
			toast.error(
				err instanceof ApiError ? err.message : "Upload failed.",
				"Could not upload",
			);
		} finally {
			URL.revokeObjectURL(localUrl);
			setUploading(false);
		}
	};

	const shape =
		variant === "avatar"
			? "h-16 w-16 rounded-full"
			: "h-36 w-full rounded-2xl md:h-48 lg:h-52";

	return (
		<div className={`relative overflow-hidden ${shape} ${className}`}>
			<img src={shown} alt={alt} className="h-full w-full object-cover" />

			{editable && (
				<button
					type="button"
					onClick={pick}
					disabled={uploading}
					aria-label="Upload image"
					className="absolute inset-0 flex items-center justify-center bg-black/40 text-white opacity-0 transition-opacity hover:opacity-100 disabled:opacity-100"
				>
					{uploading ? (
						<span className="text-xs">Uploading…</span>
					) : (
						<HiOutlineCamera className="text-2xl" />
					)}
				</button>
			)}

			<input
				ref={inputRef}
				type="file"
				accept={ACCEPTED.join(",")}
				onChange={onFile}
				className="hidden"
			/>
		</div>
	);
}
