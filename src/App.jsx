import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { algerianWilayas, beautyCategories, getWilayaName, isWilayaCode } from "./data/algerian-wilayas.js";

const questions = [
  {
    question: "Qu’est-ce que BOOKILI ?",
    answer: "BOOKILI est une plateforme dédiée à la réservation de prestations de beauté et de bien-être en Algérie.",
  },
  {
    question: "Comment prendre rendez-vous sur BOOKILI ?",
    answer: "Vous pouvez dès maintenant rechercher une prestation ou un salon par wilaya. L’annuaire des professionnels et la réservation en ligne sont en cours de préparation.",
  },
  {
    question: "Est-ce que je dois payer en ligne sur BOOKILI ?",
    answer: "Les modalités de paiement seront précisées lors de l’ouverture du service.",
  },
  {
    question: "Comment gérer mes rendez-vous sur BOOKILI ?",
    answer: "Un espace personnel est prévu pour consulter et gérer vos rendez-vous. Il est actuellement en préparation.",
  },
  {
    question: "Comment faire apparaître mon salon ou institut sur BOOKILI ?",
    answer: "L’inscription des professionnels est en préparation. Les demandes seront soumises à validation par notre équipe.",
  },
];

function Header() {
  const { pathname } = useLocation();
  const isHome = pathname === "/";
  const [scrolled, setScrolled] = useState(!isHome);

  useEffect(() => {
    function updateHeader() {
      const hero = document.getElementById("accueil");
      setScrolled(!hero || hero.getBoundingClientRect().bottom <= 80);
    }

    if (!isHome) {
      setScrolled(true);
      return undefined;
    }

    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
    window.addEventListener("resize", updateHeader);
    return () => {
      window.removeEventListener("scroll", updateHeader);
      window.removeEventListener("resize", updateHeader);
    };
  }, [isHome]);

  return (
    <header className={`site-header${scrolled ? " site-header-scrolled" : ""}`}>
      <div className="header-inner">
        <Link className="logo" to="/" aria-label="BOOKILI, accueil">BOOKILI</Link>
        <nav className="category-nav" aria-label="Catégories de beauté">
          {beautyCategories.map(({ label, value }) => (
            <Link key={value} to={`/recherche?categorie=${value}`}>{label}</Link>
          ))}
        </nav>
        <nav className="account-nav" aria-label="Accès aux espaces">
          <Link className="professional-link" to="/professionnels">
            <span className="professional-long">Je suis un professionnel de beauté</span>
            <span className="professional-short">Espace pro</span>
          </Link>
          <Link className="account-link" to="/compte">Mon compte</Link>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <Link to="/" className="footer-logo">BOOKILI</Link>
          <p>La beauté et le bien-être, près de chez vous en Algérie.</p>
        </div>
        <div className="footer-links">
          <Link to="/professionnels">Espace professionnel</Link>
          <Link to="/compte">Mon compte</Link>
          <Link to="/#faq">Questions fréquentes</Link>
        </div>
      </div>
      <div className="footer-bottom">© BOOKILI · Projet en cours de développement</div>
    </footer>
  );
}

function SearchForm() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [wilaya, setWilaya] = useState("");

  function submitSearch(event) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim().slice(0, 100));
    if (isWilayaCode(wilaya)) params.set("wilaya", wilaya);
    navigate(`/recherche${params.size ? `?${params}` : ""}`);
  }

  return (
    <form className="search-panel" onSubmit={submitSearch}>
      <div className="search-field">
        <label htmlFor="service">Que cherchez-vous ?</label>
        <input
          id="service"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Nom du salon, prestation..."
          autoComplete="off"
          maxLength={100}
        />
      </div>
      <div className="search-field location-field">
        <label htmlFor="wilaya">Où en Algérie ?</label>
        <select id="wilaya" value={wilaya} onChange={(event) => setWilaya(event.target.value)}>
          <option value="">Toutes les wilayas</option>
          {algerianWilayas.map(({ code, name }) => (
            <option key={code} value={code}>{name}</option>
          ))}
        </select>
      </div>
      <button className="search-button" type="submit">Rechercher</button>
    </form>
  );
}

function HomePage() {
  return (
    <>
      <Header />
      <main>
        <section className="hero" id="accueil" aria-labelledby="hero-title">
          <div className="hero-content">
            <h1 id="hero-title">Réservez en beauté</h1>
            <p className="hero-subtitle">Simple · Immédiat · 24h/24</p>
            <SearchForm />
            <p className="hero-notice">Recherche limitée aux 58 wilayas d’Algérie.</p>
          </div>
        </section>
        <section className="faq" id="faq" aria-labelledby="faq-title">
          <div className="faq-inner">
            <p className="eyebrow">FAQ</p>
            <h2 id="faq-title">Les questions fréquentes</h2>
            <div className="faq-list">
              {questions.map(({ question, answer }) => (
                <details key={question}>
                  <summary><span>{question}</span><span className="faq-icon" aria-hidden="true">⌄</span></summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function SearchResults() {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const query = (params.get("q") || "").trim().slice(0, 100);
  const requestedWilaya = params.get("wilaya") || "";
  const wilayaName = isWilayaCode(requestedWilaya) ? getWilayaName(requestedWilaya) : null;
  const category = beautyCategories.find(({ value }) => value === params.get("categorie"));

  return (
    <>
      <Header />
      <main className="results-page">
        <section className="results-inner" aria-labelledby="results-title">
          <Link className="results-back" to="/">← Retour à l’accueil</Link>
          <p className="eyebrow">RECHERCHE EN ALGÉRIE</p>
          <h1 id="results-title">Professionnels de beauté</h1>
          <p className="results-summary">
            {category ? `${category.label} · ` : ""}
            {query ? <>Recherche : <strong>« {query} »</strong></> : "Toutes les prestations"}
            {wilayaName ? <> · {wilayaName}</> : " · Toutes les wilayas"}
          </p>
          <div className="empty-results">
            <span className="empty-results-icon" aria-hidden="true">✦</span>
            <h2>L’annuaire ouvre bientôt</h2>
            <p>
              Nous préparons l’arrivée des professionnels sur BOOKILI. Aucun
              établissement n’est encore référencé, mais votre recherche est
              bien limitée aux wilayas d’Algérie.
            </p>
            <Link className="back-link" to="/">Modifier ma recherche</Link>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function ComingSoon({ audience, title, description }) {
  return (
    <main className="coming-page">
      <Link to="/" className="coming-logo">BOOKILI</Link>
      <div className="coming-card">
        <p className="eyebrow">{audience}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <Link className="back-link" to="/">Retour à l’accueil</Link>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/recherche" element={<SearchResults />} />
      <Route
        path="/professionnels"
        element={<ComingSoon audience="ESPACE PROFESSIONNEL" title="Votre espace arrive bientôt" description="La connexion et l’inscription des professionnels sont en cours de préparation. Les demandes seront soumises à validation par notre équipe commerciale." />}
      />
      <Route
        path="/compte"
        element={<ComingSoon audience="ESPACE CLIENT" title="Votre compte arrive bientôt" description="L’inscription, la connexion et la gestion de vos rendez-vous sont en cours de préparation." />}
      />
      <Route path="*" element={<ComingSoon audience="PAGE INTROUVABLE" title="Cette page n’existe pas" description="Vérifiez l’adresse ou retournez à l’accueil de BOOKILI." />} />
    </Routes>
  );
}
