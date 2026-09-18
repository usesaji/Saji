import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, validationError } from "@/server/http";
import {
	AVATARS_PREFIX,
	MAX_UPLOAD_BYTES,
	deleteImage,
	publicFileUrl,
	uploadImage,
} from "@/server/storage";

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		const form = await request.formData();
		const file = form.get("avatar");

		if (!file || !(file instanceof File)) {
			throw validationError({ avatar: ["The avatar field is required."] });
		}

		if (file.size > MAX_UPLOAD_BYTES) {
			throw validationError({
				avatar: ["Image must be 4 MB or smaller."],
			});
		}

		// The type is decided by the file's magic bytes inside uploadImage, not
		// by `file.type` (browser-set, forgeable) and not by the filename.
		let key: string;
		try {
			({ key } = await uploadImage(file, AVATARS_PREFIX));
		} catch (error) {
			if (error instanceof Error && error.message === "unsupported image type") {
				throw validationError({
					avatar: ["Only JPG, PNG, and WebP images are allowed."],
				});
			}
			throw error;
		}

		// Order matters: point the row at the new object BEFORE removing the old
		// one, so a failed delete can never leave the user with no avatar.
		const previous = user.avatarUrl;

		await prisma.user.update({
			where: { id: user.id },
			data: { avatarUrl: key },
		});

		await deleteImage(previous);

		return json({ avatar_url: publicFileUrl(key) });
	});
}
