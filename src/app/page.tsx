import Link from "next/link";
import Header from "./site-header";
import { algerianWilayas } from "../lib/algerian-wilayas";

const questions = [
  {
    question: "Qu’est-ce que BOOKILI ?",
    answer:
      "BOOKILI est un projet de plateforme dédiée à la réservation de prestations de beauté et de bien-être en Algérie.",
  },
  {
    question: "Comment prendre rendez-vous sur BOOKILI ?",
    answer:
      "Le formulaire permet de préciser votre recherche en Algérie. L’annuaire des professionnels et la réservation en ligne sont encore en préparation.",
  },
  {
    question: "Est-ce que je dois payer en ligne sur BOOKILI ?",
    answer:
      "Les modalités de paiement seront précisées lors de l’ouverture du service.",
  },
  {
    question: "Comment gérer mes rendez-vous sur BOOKILI ?",
    answer:
      "Un espace personnel est prévu pour consulter et gérer vos rendez-vous. Il est actuellement en préparation.",
  },
  {
    question: "Comment faire apparaître mon salon ou institut sur BOOKILI ?",
    answer:
      "L’inscription des professionnels est en préparation. Les demandes seront soumises à validation par notre équipe.",
  },
];

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <section className="hero" id="accueil" aria-labelledby="hero-title">
          <div className="hero-content">
            <h1 id="hero-title">Réservez en beauté</h1>
            <p className="hero-subtitle">Simple · Immédiat · 24h/24</p>

            <form className="search-panel" action="/recherche" method="get">
              <div className="search-field">
                <label htmlFor="service">Que cherchez-vous ?</label>
                <input
                  id="service"
                  name="q"
                  placeholder="Nom du salon, prestation..."
                  autoComplete="off"
                  maxLength={100}
                />
              </div>
              <div className="search-field location-field">
                <label htmlFor="wilaya">Où en Algérie ?</label>
                <select id="wilaya" name="wilaya" defaultValue="">
                  <option value="">Toutes les wilayas</option>
                  {algerianWilayas.map(({ code, name }) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </div>
              <button className="search-button" type="submit">Rechercher</button>
            </form>
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
                  <summary>
                    <span>{question}</span>
                    <span className="faq-icon" aria-hidden="true">⌄</span>
                  </summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <div>
            <Link href="/" className="footer-logo">BOOKILI</Link>
            <p>La beauté et le bien-être, près de chez vous en Algérie.</p>
          </div>
          <div className="footer-links">
            <Link href="/professionnels">Espace professionnel</Link>
            <Link href="/compte">Mon compte</Link>
            <a href="#faq">Questions fréquentes</a>
          </div>
        </div>
        <div className="footer-bottom">© BOOKILI · Projet en cours de développement</div>
      </footer>
    </>
  );
}
