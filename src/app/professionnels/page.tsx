import Link from "next/link";

export default function ProfessionalsPage() {
  return (
    <main className="coming-page">
      <Link href="/" className="coming-logo">BOOKILI</Link>
      <div className="coming-card">
        <p className="eyebrow">ESPACE PROFESSIONNEL</p>
        <h1>Votre espace arrive bientôt</h1>
        <p>
          La connexion et l’inscription des professionnels sont en cours de
          préparation. Les demandes d’inscription seront soumises à validation
          par notre équipe commerciale.
        </p>
        <Link className="back-link" href="/">Retour à l’accueil</Link>
      </div>
    </main>
  );
}
