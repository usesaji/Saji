import Link from "next/link";
import React from "react";
import { IoIosArrowRoundForward } from "react-icons/io";

const ActivityCard = () => {
	return (
		<div className="bg-[#f8f8f8] rounded-xl py-4 px-2 md:py-5 md:px-6">
			<div className="flex items-start gap-1">
				<div className="">
					<svg
						className="scale-[0.8]"
						width="48"
						height="48"
						viewBox="0 0 48 48"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
					>
						<rect
							width="47.0553"
							height="47.0553"
							rx="23.5277"
							fill="#FFE6F3"
						/>
						<path
							d="M22.6812 13.5006C22.2277 13.3418 21.5917 13.4955 21.2607 13.8436L16.7278 18.6104C16.3968 18.9585 16.496 19.3693 16.9494 19.5282L27.7254 23.3004C28.1789 23.4591 28.8147 23.3056 29.1459 22.9575L33.6788 18.1907C34.0098 17.8424 33.9106 17.4316 33.4572 17.2729L22.6812 13.5006Z"
							fill="#FF0084"
						/>
						<path
							d="M21.3784 22.9897C20.925 22.8308 20.289 22.9844 19.958 23.3325L15.4251 28.0994C15.0941 28.4475 15.1932 28.8584 15.6466 29.017L26.4227 32.7893C26.8761 32.9481 27.512 32.7946 27.8431 32.4464L32.3759 27.6795C32.707 27.3314 32.6077 26.9206 32.1543 26.7618L21.3784 22.9897Z"
							fill="#FF0084"
						/>
					</svg>
				</div>

				<div className="">
					<h5 className="flex gap-3 items-center">
						<span className="text-sm font-medium">Withdrawal Completed</span>
						<span className="text-xs">10:23</span>
					</h5>

					<p className="text-sm text-light leading-[122%] mt-2 md:mt-4">
						Your group &apos;Summer Funds&apos; has been successfully created.
						Now, invite your community to start growing together.
					</p>

					<Link
						href="#"
						className="flex items-center text-primary mt-2 md:mt-4"
					>
						<span className="text-sm">View Transaction</span>
						<IoIosArrowRoundForward className="text-lg md:text-2xl" />
					</Link>
				</div>
			</div>
		</div>
	);
};

export default ActivityCard;
