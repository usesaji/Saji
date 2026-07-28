import GroupPreview from "@/features/group/GroupPreview";
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

	console.log(id);

	if (!group) {
		return <div>Group not found</div>;
	}

	return (
		<div>
			<GoBack />
			<GroupPreview group={group} />
		</div>
	);
}

// import React from "react";
// import GroupPreview from "../../../../features/group/GroupPreview";
// import GoBack from "../../../../components/dashboard/GoBack";

// export default function Page() {
// 	return (
// 		<div>
// 			<GoBack />
// 			<GroupPreview />
// 		</div>
// 	);
// }
