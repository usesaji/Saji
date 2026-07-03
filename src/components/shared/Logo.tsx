import Image from "next/image";
import Link from "next/link";
import { pageRoutes } from "../../config/routes";

const Logo = ({
	height = "h-6 sm:h-[36px]",
	link,
	variant = "blue",
}: {
	height?: string;
	link?: string;
	variant?: "blue" | "lightblue" | "black" | "white";
}) => {
	return (
		<Link href={link || pageRoutes.landingPage}>
			<div className={`${height} w-fit bgred-400`}>
				<Image
					src={`/images/logos/logo-${variant}.svg`}
					alt="Stellance Logo"
					width={100}
					loading="eager"
					height={100}
					className="h-full w-full object-contain"
				/>
			</div>
		</Link>
	);
};

export default Logo;
