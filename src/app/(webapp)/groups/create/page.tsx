import React from "react";
import CreateGroupForm from "../../../../features/group/CreateGroupForm";
import GoBack from "../../../../components/dashboard/GoBack";

export default function Page() {
	return (
		<div>
			<GoBack />
			<div className="mt-4">
				<CreateGroupForm />
			</div>
		</div>
	);
}
