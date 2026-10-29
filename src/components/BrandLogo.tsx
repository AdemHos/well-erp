import Image from "next/image";

export default function BrandLogo({ className = "h-14 w-24", variant = "light" }: { className?: string; variant?: "light" | "dark" | "theme" }) {
  if (variant === "theme") return <span className={`relative inline-block shrink-0 ${className}`}><Image src="/images/logo.png" alt="WellPOS" fill sizes="(max-width: 640px) 120px, 160px" className="brand-logo-light object-contain"/><Image src="/images/logo-dark.png" alt="WellPOS" fill sizes="(max-width: 640px) 120px, 160px" className="brand-logo-dark object-contain"/></span>;
  return <Image src={variant === "dark" ? "/images/logo-dark.png" : "/images/logo.png"} alt="WellPOS" width={1536} height={1024} sizes="(max-width: 640px) 120px, 160px" className={`object-contain ${className}`} />;
}
