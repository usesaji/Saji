import React from "react";
import Logo from "../shared/Logo";
import { RiInstagramFill } from "react-icons/ri";
import Link from "next/link";
import { FaFacebookSquare } from "react-icons/fa";
import { BsTwitter } from "react-icons/bs";
import { IoLogoYoutube } from "react-icons/io";

const Footer = () => {
	return (
		<footer className="pt-18.5 sm:pt-30">
			<div className="custom-container">
				<div className="grid grid-cols-2 sm:grid-cols-4 max-sm:gap-10 ">
					<div className="place-self-center h-full">
						<Logo />
						<div className="text-xl text-primary-dark-active flex gap-3 mt-5">
							<Link href="#">
								<IoLogoYoutube />
							</Link>
							<Link href="#">
								<RiInstagramFill />
							</Link>
							<Link href="#">
								<FaFacebookSquare />
							</Link>
							<Link href="#">
								<BsTwitter />
							</Link>
						</div>
					</div>

					<div className="font-light flex place-self-center flex-col max-md:text-sm gap-2">
						<Link href="#">Features</Link>
						<Link href="#">How it works</Link>
						<Link href="#">Trust Score</Link>
						<Link href="#">Security</Link>
					</div>
					<div className="font-light flex flex-col place-self-center max-md:text-sm gap-2">
						<Link href="#">Savings Circle</Link>
						<Link href="#">Success Stories</Link>
						<Link href="#">Help Center</Link>
						<Link href="#">FAQ</Link>
					</div>
					<div className="font-light flex flex-col max-md:text-sm place-self-center gap-2">
						<Link href="#">Terms of Service</Link>
						<Link href="#">Privacy Policy</Link>
						<Link href="#">Cookie Policy</Link>
					</div>
				</div>
				<div className="border-t-[#b3b3b3] border-t-[0.5px] mt-10 pb-5 md:mt-37">
					<p className="mt-6 text-center">&copy; 2026 - usesajiapp</p>
				</div>
			</div>
		</footer>
	);
};

export default Footer;
