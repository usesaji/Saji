import InviteMembersForm from "@/features/group/InviteMembersForm";
import { getCircleById } from "../../../../../lib/utils/mock-data";

interface InvitePageProps {
	params: Promise<{ groupId: string }>;
}

export default async function InvitePage({ params }: InvitePageProps) {
	const { groupId: id } = await params;
	const group = getCircleById(id);

	if (!group) {
		return <div>Group not found</div>;
	}

	return <InviteMembersForm group={group} />;
}
