import ContributeForm from "@/features/group/ContributeForm";
import { getCircleById } from "../../../../../lib/utils/mock-data";

interface ContributePageProps {
	params: Promise<{ groupId: string }>;
}

export default async function ContributePage({ params }: ContributePageProps) {
	const { groupId: id } = await params;
	const group = getCircleById(id);

	if (!group) {
		return <div>Group not found</div>;
	}

	return <ContributeForm group={group} />;
}
