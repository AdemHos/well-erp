import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";



const geistSans = localFont({
  src: "../../public/fonts/DejaVuSans.ttf",
  variable: "--font-geist-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "WellPOS",
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48" }, { url: "/images/favicon-192.png", type: "image/png", sizes: "192x192" }],
    apple: [{ url: "/images/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  description: "Developed by WellSoft",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="tr"
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
