import React from "react";
import { PiWalletLight } from "react-icons/pi";
import { Button } from "../../components/ui/button";
import { pageRoutes } from "../../config/routes";

export default function UpcomingContribution() {
	return (
		<section className="mt-7.5 md:mt-10">
			<div className="bg-[#feeeee] rounded-[20px] p-5 md:p-6 flex max-md:flex-col gap-4 md:items-center md:justify-between">
				<div className="min-w-0">
					<h4 className="text-sm md:text-base font-semibold text-neutral-dark">
						Upcoming Contribution
					</h4>
					<p className="text-xs font-light mt-1.5 leading-relaxed md:max-w-md">
						Your monthly group contribution of $450.00 is due in 3 days. Ensure
						you leave enough balance to avoid missed payment penalties.
					</p>
				</div>

				<Button
					href={pageRoutes.dashboardRoutes.WALLET_ADD_MONEY}
					variant="dark"
					className="w-full md:w-fit shrink-0"
				>
					<PiWalletLight className="text-lg" />
					<span className="lg:text-base">Fund Account</span>
				</Button>
			</div>
		</section>
	);
}
