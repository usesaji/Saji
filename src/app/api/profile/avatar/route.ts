import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { handle, json, validationError, forbidden, notFound } from "@/server/http";

const AVATARS_DIR = path.join(process.cwd(), "public", "storage", "avatars");
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

export async function POST(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);

		const form = await request.formData();
		const file = form.get("avatar");

		if (!file || !(file instanceof File)) {
			throw validationError({ avatar: ["The avatar field is required."] });
		}

		if (!ALLOWED.includes(file.type)) {
			throw validationError({
				avatar: ["Only JPG, PNG, and WebP images are allowed."],
			});
		}

		if (file.size > MAX_BYTES) {
			throw validationError({
				avatar: ["Image must be 5 MB or smaller."],
			});
		}

		await deleteOldStorageFile(user.avatarUrl);

		const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
		const filename = `${randomUUID()}.${ext}`;
		const filePath = path.join(AVATARS_DIR, filename);

		await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

		const url = `/storage/avatars/${filename}`;
		await prisma.user.update({
			where: { id: user.id },
			data: { avatarUrl: url },
		});

		return json({ avatar_url: url });
	});
}
