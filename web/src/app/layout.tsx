import type { Metadata } from "next";
import { Geist_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const uiSans = IBM_Plex_Sans({
  variable: "--font-ui-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const displaySerif = Newsreader({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "600"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "ScienceDash",
  description: "Local-first research dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${uiSans.variable} ${geistMono.variable} ${displaySerif.variable}`}
    >
      <body>
        <div className="appBg" aria-hidden="true" />
        <div className="appShell">
          <header className="topbar">
            <div className="brand">
              <div className="brandMark" aria-hidden="true">
                SD
              </div>
              <div className="brandText">
                <div className="brandName">ScienceDash</div>
                <div className="brandTag">Research OS · local</div>
              </div>
            </div>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
