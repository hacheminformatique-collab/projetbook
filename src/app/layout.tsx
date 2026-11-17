import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BOOKILI | Réservez en beauté",
  description:
    "BOOKILI, votre plateforme de rendez-vous beauté et bien-être en Algérie.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
