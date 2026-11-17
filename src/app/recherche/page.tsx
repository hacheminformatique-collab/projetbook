import { Suspense } from "react";
import Link from "next/link";
import Header from "../site-header";
import {
  beautyCategories,
  getWilayaName,
  isWilayaCode,
} from "../../lib/algerian-wilayas";

type SearchPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    wilaya?: string | string[];
    categorie?: string | string[];
  }>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function SearchResults({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const query = firstValue(params.q)?.trim().slice(0, 100) ?? "";
  const requestedWilaya = firstValue(params.wilaya) ?? "";
  const wilayaCode = isWilayaCode(requestedWilaya) ? requestedWilaya : "";
  const wilayaName = getWilayaName(wilayaCode);
  const requestedCategory = firstValue(params.categorie);
  const category = beautyCategories.find(({ value }) => value === requestedCategory);

  return (
    <section className="results-inner" aria-labelledby="results-title">
      <Link className="results-back" href="/">← Retour à l’accueil</Link>
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
        <Link className="back-link" href="/">Modifier ma recherche</Link>
      </div>
    </section>
  );
}

export default function SearchPage(props: SearchPageProps) {
  return (
    <>
      <Header />
      <main className="results-page">
        <Suspense fallback={<p className="results-inner">Chargement de votre recherche…</p>}>
          <SearchResults {...props} />
        </Suspense>
      </main>
      <footer className="footer">
        <div className="footer-bottom">© BOOKILI · Projet en cours de développement</div>
      </footer>
    </>
  );
}
