import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "auth-lab",
  description: "Authentication and session lifecycle lab"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
