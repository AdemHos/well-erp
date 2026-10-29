import AISection from "@/components/landing/AISection";
import BenefitsBar from "@/components/landing/BenefitsBar";
import CTA from "@/components/landing/CTA";
import DevicesSection from "@/components/landing/Devices";
import FeatureBar from "@/components/landing/FeatureBar";
import Features from "@/components/landing/Features";
import Footer from "@/components/landing/Footer";
import Hero from "@/components/landing/Hero";
import Integrations from "@/components/landing/Integrations";
import Navbar from "@/components/landing/Navbar";
import Pricing from "@/components/landing/Pricing";
import UseCases from "@/components/landing/UseCases";


export default function Home() {
  return (
    <main>
      <Navbar/>
      <Hero/>
      <FeatureBar/>
      <Features/>
      <AISection/>
      <Integrations/>
      <DevicesSection/>
      <BenefitsBar/>
      <UseCases/>
      <Pricing/>
      <CTA/>
      <Footer/>
    </main>
  );
}
