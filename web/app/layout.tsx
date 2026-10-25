import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Liedar — A second look at your documents",
  description: "Check PDFs and images for signs of editing, copied regions, and inconsistencies.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
