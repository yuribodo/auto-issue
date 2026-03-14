import type { Metadata } from "next";
import { Syne, Azeret_Mono, DM_Sans } from "next/font/google";
import "./globals.css";

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["700", "800"],
});

const azeretMono = Azeret_Mono({
  variable: "--font-azeret",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const dmSans = DM_Sans({
  variable: "--font-dm",
  subsets: ["latin"],
  weight: ["300", "400", "500"],
});

export const metadata: Metadata = {
  title: "Auto-Issue — GitHub Issues that ship themselves",
  description:
    "Label an issue. An AI agent writes the code, runs the tests, and opens a PR.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${syne.variable} ${azeretMono.variable} ${dmSans.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
