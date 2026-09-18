import About from "../../components/landing/About";
import Cta from "../../components/landing/Cta";
import Faq from "../../components/landing/Faq";
import Footer from "../../components/landing/Footer";
import Header from "../../components/landing/Header";
import Hero from "../../components/landing/Hero";
import Reviews from "../../components/landing/Reviews";

export default function Home() {
	return (
		<div className="pt-24 sm:pt-32">
			<Header />
			<Hero />
			<About />
			<Faq />
			<Reviews />
			<Cta />
			<Footer />
		</div>
	);
}
