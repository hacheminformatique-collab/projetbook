import Link from "next/link";

export default function AccountPage() {
  return (
    <main className="coming-page">
      <Link href="/" className="coming-logo">BOOKILI</Link>
      <div className="coming-card">
        <p className="eyebrow">ESPACE CLIENT</p>
        <h1>Votre compte arrive bientôt</h1>
        <p>
          L’inscription, la connexion et la gestion de vos rendez-vous sont en
          cours de préparation.
        </p>
        <Link className="back-link" href="/">Retour à l’accueil</Link>
      </div>
    </main>
  );
}
