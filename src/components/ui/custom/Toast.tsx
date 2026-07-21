"use client";

import { AnimatePresence, motion } from "framer-motion";
import { IoClose } from "react-icons/io5";
import { useToastStore } from "../../../lib/store/toast-store";

export default function Toast() {
	const { open, close, title, message, variant } = useToastStore();

	const variants = {
		success: {
			bg: "bg-[#ECE6FE]",
			text: "text-[#1D006E]",
		},
		error: {
			bg: "bg-[#FFE2E2] ",
			text: "text-[#8E0000]",
		},
		info: {
			bg: "bg-[#E8E8E9]",
			text: "text-[#161A21]",
		},
		warning: {
			bg: "bg-[#FEFCEA]",
			text: "text-[#853800]",
		},
	};

	const current = variants[variant];

	return (
		<AnimatePresence>
			{open && (
				<motion.div
					initial={{
						x: 100,
						opacity: 0,
					}}
					animate={{
						x: 0,
						opacity: 1,
					}}
					exit={{
						x: 100,
						opacity: 0,
					}}
					transition={{
						duration: 0.25,
					}}
					className="fixed top-8 right-0 z-50 w-full max-w-110 px-4 sm:px-8"
				>
					<div
						className={`relative ${current.bg} p-5 rounded-[15px] w-full border-[0.3px] border-[#A7A7A74D] backdrop-blur-[14.2px]`}
					>
						<button onClick={close} className={`absolute top-3 right-3.5`}>
							<IoClose />
						</button>

						<div className={current.text}>
							{title && <h4 className="font-medium text-base">{title}</h4>}

							<p className="text-[12px]">{message}</p>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
