import GroupRotationEditor from "@/features/group/GroupRotationEditor";
import { getCircleById } from "../../../../../lib/utils/mock-data";
import GoBack from "../../../../../components/dashboard/GoBack";

interface RotationPageProps {
	params: Promise<{ groupId: string }>;
}

export default async function RotationPage({ params }: RotationPageProps) {
	const { groupId: id } = await params;
	const group = getCircleById(id);

	if (!group) {
		return <div>Group not found</div>;
	}

	return (
		<div>
			<GoBack />
			<GroupRotationEditor group={group} />
		</div>
	);
}
