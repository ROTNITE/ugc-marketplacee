import type { Metadata } from "next";
import { AuthProvider } from "./auth-context";
import { I18nProvider, LanguageToggle } from "./i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "UGC Marketplace",
  description: "Starter scaffold for a bilingual UGC influencer marketplace."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <I18nProvider>
          <AuthProvider>
            <LanguageToggle />
            {children}
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
