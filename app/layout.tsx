// This is the corrected code for your app/layout.tsx file

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // You can customize these for your site
  title: "Insight Engine",
  description: "Stock & Index Analyzer for Options Data",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      {/* 
        HERE IS THE FIX: 
        We are keeping your fonts and adding the background and text color classes.
      */}
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-brand-dark text-gray-300`}
      >
        {children}
      </body>
    </html>
  );
}