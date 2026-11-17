"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function Header() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function updateHeader() {
      const hero = document.getElementById("accueil");
      setScrolled(!hero || hero.getBoundingClientRect().bottom <= 80);
    }

    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("resize", updateHeader);
    return () => {
      window.removeEventListener("scroll", updateHeader);
      window.removeEventListener("resize", updateHeader);
    };
  }, []);

  return (
    <header className={`site-header${scrolled ? " site-header-scrolled" : ""}`}>
      <div className="header-inner">
        <Link className="logo" href="/" aria-label="BOOKILI, accueil">BOOKILI</Link>
        <nav className="category-nav" aria-label="Catégories à venir">
          <span>Coiffeur</span>
          <span>Barbier</span>
          <span>Manucure</span>
          <span>Institut de beauté</span>
          <span>Bien-être</span>
          <span>Offrir</span>
        </nav>
        <nav className="account-nav" aria-label="Accès aux espaces">
          <Link className="professional-link" href="/professionnels">
            <span className="professional-long">Je suis un professionnel de beauté</span>
            <span className="professional-short">Espace pro</span>
          </Link>
          <Link className="account-link" href="/compte">Mon compte</Link>
        </nav>
      </div>
    </header>
  );
}
