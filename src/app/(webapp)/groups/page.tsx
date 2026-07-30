import React from "react";
import GroupStats from "../../../features/group/GroupStats";
import GroupList from "../../../features/group/GroupList";
import CreateGroupFloatBtn from "../../../features/group/CreateGroupFloatBtn";
import NoGroupPreview from "../../../features/group/NoGroupPreview";
import { circleGroups } from "../../../lib/utils/mock-data";

export default function Page() {
	const myGroups = circleGroups.filter((circle) => circle.membership !== "none").length;

	if (myGroups === 0) {
		return <NoGroupPreview />;
	}

	return (
		<div>
			<section className="flex items-center justify-between gap-3">
				<h2 className="text-xl font-light md:text-3xl md:font-normal">
					Active Groups
				</h2>
			</section>

			<GroupStats />
			<GroupList />
			<CreateGroupFloatBtn />
		</div>
	);
}
