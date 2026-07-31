import React from "react";
import { PiGaugeLight } from "react-icons/pi";

export default function SecurityInfoBanner() {
	return (
		<div className="bg-primary-light rounded-[20px] p-5 flex items-start gap-3.5">
			<span className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-primary text-lg shrink-0">
				<PiGaugeLight />
			</span>
			<div>
				<h4 className="text-sm font-semibold text-primary-darker">
					Is my information safe?
				</h4>
				<p className="text-xs font-light text-primary-dark mt-1 leading-relaxed">
					Yes. Your details are encrypted and only used to verify your
					withdrawals — we never share this information with anyone else.
				</p>
			</div>
		</div>
	);
}
