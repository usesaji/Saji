import React from "react";
import { Button } from "../ui/button";
import Logo from "../shared/Logo";

const Header = () => {
	return (
		<header className="bg-white lg:px-10 py-5 sm:py-8">
			<div className="custom-container flex justify-between items-center">
				<div className="flex items-center gap-10 lg:gap-13">
					<Logo />
					<ul className="max-md:hidden flex gap-10 lg:gap-13 text-xl lg:text-2xl">
						<li>
							<a href="">About</a>
						</li>
						<li>
							<a href="">Contact</a>
						</li>
						<li>
							<a href="">Help</a>
						</li>
					</ul>
				</div>
				<div className="flex gap-2.5">
					<Button variant="secondary">Log In</Button>
					<Button variant="default">Get Started</Button>
				</div>
			</div>
		</header>
	);
};

export default Header;
