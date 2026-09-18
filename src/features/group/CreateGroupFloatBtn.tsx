import Link from "next/link";
import React from "react";
import { FiPlus } from "react-icons/fi";
import { pageRoutes } from "../../config/routes";

const CreateGroupFloatBtn = () => {
	return (
		<Link
			href={pageRoutes.dashboardRoutes.NEW_GROUP}
			className="hover:scale-[0.9] active:scale-[1.1] duration-150 lg:hidden fixed rounded-full bg-primary flex justify-center items-center bottom-[10%] right-[6%] z-100 w-15 h-15 sm:h-20 sm:w-20 cursor-pointer"
		>
			<FiPlus className="text-4xl text-white" />
		</Link>
	);
};

export default CreateGroupFloatBtn;
