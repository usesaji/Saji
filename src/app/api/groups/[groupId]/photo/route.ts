import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import {
	handle,
	json,
	validationError,
	forbidden,
	notFound,
} from "@/server/http";
import { findGroupOr404, assertOrganizer } from "@/server/groups";

const GROUP_PHOTOS_DIR = path.join(
	process.cwd(),
	"public",
	"storage",
	"group-photos",
);
const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

async function deleteOldStorageFile(url: string | null): Promise<void> {
	if (!url || !url.startsWith("/storage/")) return;
	const filePath = path.join(process.cwd(), "public", url);
	try {
		await unlink(filePath);
	} catch {
		// already gone — not an error
	}
}

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

		if (!ALLOWED.includes(file.type)) {
			throw validationError({
				photo: ["Only JPG, PNG, and WebP images are allowed."],
			});
		}

		if (file.size > MAX_BYTES) {
			throw validationError({
				photo: ["Image must be 5 MB or smaller."],
			});
		}

		await deleteOldStorageFile(group.photoUrl);

		const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
		const filename = `${randomUUID()}.${ext}`;
		const filePath = path.join(GROUP_PHOTOS_DIR, filename);

		await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

		const url = `/storage/group-photos/${filename}`;
		await prisma.group.update({
			where: { id: group.id },
			data: { photoUrl: url },
		});

		return json({ photo_url: url });
	});
}
