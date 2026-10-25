import type { Metadata } from "next";
import { DM_Sans, Geist_Mono, Lato } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], display: "swap", variable: "--font-dm-sans" });
const mono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-geist-mono" });
const wordmark = Lato({ subsets: ["latin"], weight: "400", display: "swap", variable: "--font-wordmark" });

export const metadata: Metadata = {
  title: "Liedar — A second look at your documents",
  description: "Check PDFs and images for signs of editing, copied regions, and inconsistencies.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${sans.variable} ${mono.variable} ${wordmark.variable}`}><body>{children}</body></html>;
}
