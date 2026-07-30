import GroupPageClient from "@/features/group/GroupPageClient";
import { getCircleById } from "../../../../lib/utils/mock-data";
import GoBack from "../../../../components/dashboard/GoBack";

interface GroupPreviewPageProps {
	// Next.js 15+ passes route params as a Promise. If you're on Next 14
	// or earlier, change this to `params: { id: string }` and drop the `await`.
	params: Promise<{ groupId: string }>;
}

export default async function GroupPreviewPage({
	params,
}: GroupPreviewPageProps) {
	const { groupId: id } = await params;
	const group = getCircleById(id);

	if (!group) {
		return <div>Group not found</div>;
	}

	return (
		<div>
			<GoBack />
			<GroupPageClient group={group} />
		</div>
	);
}
