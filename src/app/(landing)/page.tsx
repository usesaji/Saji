import About from "../../components/landing/About";
import Faq from "../../components/landing/Faq";
import Header from "../../components/landing/Header";
import Hero from "../../components/landing/Hero";

export default function Home() {
	return (
		<div className="pt-24 sm:pt-32 pb-20">
			<Header />
			<Hero />
			<About />
			<Faq />
		</div>
	);
}
