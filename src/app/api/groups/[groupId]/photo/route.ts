import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, validationError } from "@/server/http";
import { findGroupOr404, assertOrganizer } from "@/server/groups";
import {
	GROUP_PHOTOS_PREFIX,
	MAX_UPLOAD_BYTES,
	deleteImage,
	publicFileUrl,
	uploadImage,
} from "@/server/storage";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ groupId: string }> },
) {
	return handle(async () => {
		const user = await requireUser(request);
		const { groupId } = await params;

		const group = await findGroupOr404(groupId);
		assertOrganizer(group, user.id);

		const form = await request.formData();
		const file = form.get("photo");

		if (!file || !(file instanceof File)) {
			throw validationError({ photo: ["The photo field is required."] });
		}

		if (file.size > MAX_UPLOAD_BYTES) {
			throw validationError({
				photo: ["Image must be 4 MB or smaller."],
			});
		}

		// The type is decided by the file's magic bytes inside uploadImage, not
		// by `file.type` (browser-set, forgeable) and not by the filename.
		let key: string;
		try {
			({ key } = await uploadImage(file, GROUP_PHOTOS_PREFIX));
		} catch (error) {
			if (error instanceof Error && error.message === "unsupported image type") {
				throw validationError({
					photo: ["Only JPG, PNG, and WebP images are allowed."],
				});
			}
			throw error;
		}

		// Order matters: point the row at the new object BEFORE removing the old
		// one, so a failed delete can never leave the group with no photo.
		const previous = group.photoUrl;

		await prisma.group.update({
			where: { id: group.id },
			data: { photoUrl: key },
		});

		await deleteImage(previous);

		return json({ photo_url: publicFileUrl(key) });
	});
}
