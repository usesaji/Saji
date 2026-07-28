import React from "react";
import GroupStats from "../../../features/group/GroupStats";
import GroupList from "../../../features/group/GroupList";
// import { Button } from "../../../components/ui/button";

export default function Page() {
	return (
		<div>
			<section className="flex items-center justify-between gap-3">
				<h2 className="text-xl font-light md:text-3xl md:font-normal">
					Active Groups
				</h2>
				{/* <Button>Create Group</Button> */}
			</section>

			<GroupStats />

			<GroupList />
		</div>
	);
}
