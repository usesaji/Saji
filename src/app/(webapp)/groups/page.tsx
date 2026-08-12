import React from "react";
import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import GroupStats from "../../../features/group/GroupStats";
import GroupList from "../../../features/group/GroupList";
import CreateGroupFloatBtn from "../../../features/group/CreateGroupFloatBtn";

export default function Page() {
	return (
		<div className="mx-auto max-w-3xl pb-10">
			<section className="flex items-center justify-between gap-3">
				<h2 className="text-xl font-light md:text-2xl md:font-normal">
					Active Groups
				</h2>
				<button
					type="button"
					className="flex items-center gap-1.5 rounded-full border border-neutral-light-hover px-3 py-1.5 text-sm"
				>
					<HiOutlineAdjustmentsHorizontal className="text-base" />
					Filter
				</button>
			</section>

			<GroupStats />
			<GroupList />

			{/* Public saving groups = open circles anyone can join. */}

			<CreateGroupFloatBtn />
		</div>
	);
}
