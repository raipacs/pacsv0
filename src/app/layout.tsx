import type { Metadata } from "next"

import "./globals.css"

export const metadata: Metadata = {
  title: {
    default: "RAI PACS",
    template: "%s | RAI PACS",
  },
  description: "Bulut tabanli PACS ve radyoloji is istasyonu.",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  )
}
