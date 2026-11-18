import { Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { algerianWilayas, beautyCategories, getWilayaName, isWilayaCode } from "./data/algerian-wilayas.js";
import { Appointments, DirectoryResults, SalonPage } from "./Booking.jsx";
import ProfessionalSpace from "./Professional.jsx";

const questions = [
  {
    question: "Qu’est-ce que BOOKILI ?",
    answer: "BOOKILI est une plateforme dédiée à la réservation de prestations de beauté et de bien-être en Algérie.",
  },
  {
    question: "Comment prendre rendez-vous sur BOOKILI ?",
    answer: "Recherchez un salon ou une prestation par ville ou wilaya, choisissez un créneau disponible et connectez-vous à votre compte client pour confirmer votre rendez-vous.",
  },
  {
    question: "Est-ce que je dois payer en ligne sur BOOKILI ?",
    answer: "La réservation est gratuite pour les particuliers. Le paiement de la prestation s’effectue sur place auprès du professionnel.",
  },
  {
    question: "Comment gérer mes rendez-vous sur BOOKILI ?",
    answer: "Votre espace client permet de consulter les rendez-vous passés et à venir, d’annuler un rendez-vous à venir ou de modifier son créneau et sa prestation selon les disponibilités.",
  },
  {
    question: "Comment faire apparaître mon salon ou institut sur BOOKILI ?",
    answer: "Inscrivez-vous depuis l’espace professionnel. Après validation commerciale, renseignez vos prestations et horaires, puis publiez votre établissement.",
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
  const [hasImage, setHasImage] = useState(false);
  return (
    <>
      <Header />
      <main>
        <section className={`hero${hasImage ? " hero-with-image" : ""}`} id="accueil" aria-labelledby="hero-title">
          <img className="hero-image" src="/api/homepage-image.php" alt="" aria-hidden="true" onLoad={() => setHasImage(true)} onError={() => setHasImage(false)} />
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
          <DirectoryResults search={search} />
          <Link className="back-link" to="/">Modifier ma recherche</Link>
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

function AuthPage({ professional = false, commercial = false, superAdmin = false, onAuthenticated }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState(
    !commercial && !superAdmin && searchParams.get("mode") === "inscription" ? "register" : "login",
  );
  const [csrfToken, setCsrfToken] = useState("");
  const [csrfError, setCsrfError] = useState("");
  const [notice, setNotice] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/csrf.php", { credentials: "same-origin" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Impossible de préparer le formulaire.");
        if (active) setCsrfToken(data.csrfToken);
      })
      .catch(() => {
        if (active) setCsrfError("Le formulaire est temporairement indisponible. Vérifiez la configuration du serveur puis rechargez la page.");
      });
    return () => { active = false; };
  }, []);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setNotice(null);
    setIsSubmitting(true);

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const endpoint = mode === "login"
      ? "/api/login.php"
      : professional ? "/api/register-professional.php" : "/api/register-client.php";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        setNotice({ kind: "error", text: result.error || "Le formulaire n’a pas pu être envoyé." });
        return;
      }

      if (mode === "login") {
        const isClient = result.account?.role === "client";
        const allowedRoles = superAdmin
          ? ["super_admin"]
          : commercial
          ? ["commercial", "super_admin"]
          : [professional ? "professional" : "client"];
        if (!allowedRoles.includes(result.account?.role)) {
          await fetch("/api/logout.php", {
            method: "POST",
            credentials: "same-origin",
            headers: { "X-CSRF-Token": result.csrfToken },
          });
          setCsrfToken("");
          const csrfResponse = await fetch("/api/csrf.php", { credentials: "same-origin" });
          const csrfResult = await csrfResponse.json();
          if (csrfResponse.ok) setCsrfToken(csrfResult.csrfToken);
          setNotice({ kind: "error", text: "Ce compte ne correspond pas à cet espace." });
          return;
        }
        setCsrfToken(result.csrfToken);
        if (onAuthenticated) {
          onAuthenticated(result.account, result.csrfToken);
        } else if (commercial) {
          navigate("/gestion-commercial");
        } else {
          const returnTo = searchParams.get("retour") || "";
          const safeReturn = /^\/salons\/[1-9][0-9]*(?:\?appointmentId=[1-9][0-9]*)?$/.test(returnTo);
          navigate(isClient ? safeReturn ? returnTo : "/espace-client" : "/espace-professionnel");
        }
        return;
      }

      if (professional) {
        setNotice({ kind: "success", text: result.message });
        form.reset();
      } else {
        setMode("login");
        setNotice({ kind: "success", text: `${result.message} Vous pouvez vous connecter.` });
        form.reset();
      }
    } catch {
      setNotice({ kind: "error", text: "Impossible de joindre BOOKILI. Vérifiez votre connexion et réessayez." });
    } finally {
      setIsSubmitting(false);
    }
  }

  const title = superAdmin
    ? "Connexion super-admin"
    : commercial
    ? "Connexion équipe BOOKILI"
    : professional
    ? mode === "login" ? "Connexion professionnelle" : "Créer votre espace professionnel"
    : mode === "login" ? "Connexion à votre compte" : "Créer votre compte BOOKILI";

  return (
    <main className="auth-page">
      <Link to="/" className="coming-logo">BOOKILI</Link>
      <section className="auth-card" aria-labelledby="auth-title">
        <p className="eyebrow">{superAdmin ? "SUPER-ADMIN" : commercial ? "GESTION COMMERCIALE" : professional ? "ESPACE PROFESSIONNEL" : "ESPACE CLIENT"}</p>
        <h1 id="auth-title">{title}</h1>
        {!commercial && !superAdmin && (
          <div className="auth-switch" aria-label="Choisir une action">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setNotice(null); }}>
              Se connecter
            </button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setNotice(null); }}>
              {professional ? "Demander un accès" : "Créer un compte"}
            </button>
          </div>
        )}
        {csrfError && <p className="form-message form-error" role="alert">{csrfError}</p>}
        {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}

        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && !professional && (
            <div className="auth-grid">
              <label>Prénom<input name="firstName" required autoComplete="given-name" maxLength={100} /></label>
              <label>Nom<input name="lastName" required autoComplete="family-name" maxLength={100} /></label>
            </div>
          )}
          {mode === "register" && professional && (
            <>
              <label>Nom du salon ou de l’établissement<input name="businessName" required autoComplete="organization" maxLength={180} /></label>
              <label>Nom du responsable<input name="contactName" required autoComplete="name" maxLength={100} /></label>
              <div className="auth-grid">
                <label>Activité
                  <select name="category" required defaultValue="">
                    <option value="" disabled>Choisir une activité</option>
                    <option value="coiffeur">Coiffure</option>
                    <option value="barbier">Barbier</option>
                    <option value="manucure">Manucure</option>
                    <option value="institut">Institut de beauté</option>
                    <option value="bien-etre">Bien-être</option>
                    <option value="maquillage">Maquillage</option>
                    <option value="spa">Spa</option>
                    <option value="massage">Massage</option>
                  </select>
                </label>
                <label>Wilaya
                  <select name="wilaya" required defaultValue="">
                    <option value="" disabled>Choisir une wilaya</option>
                    {algerianWilayas.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </label>
              </div>
              <div className="auth-grid">
                <label>Ville ou commune<input name="city" required autoComplete="address-level2" maxLength={120} /></label>
                <label>Adresse<input name="address" required autoComplete="street-address" maxLength={255} /></label>
              </div>
            </>
          )}
          <label>Adresse e-mail
            <input name="email" type="email" required autoComplete="email" maxLength={254} />
          </label>
          {mode === "register" && (
            <label>Téléphone
              <input name="phone" type="tel" required autoComplete="tel" inputMode="tel" maxLength={24} placeholder="+213..." />
            </label>
          )}
          {mode === "register" && !professional && (
            <label>Date de naissance
              <input name="dateOfBirth" type="date" required autoComplete="bday" />
            </label>
          )}
          <label>Mot de passe
            <input name="password" type="password" required minLength={mode === "register" ? 12 : 1} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} />
            {mode === "register" && <span className="field-hint">Au moins 12 caractères.</span>}
          </label>
          <button className="auth-submit" type="submit" disabled={!csrfToken || isSubmitting}>
            {isSubmitting ? "Veuillez patienter…" : mode === "login" ? "Se connecter" : professional ? "Envoyer ma demande" : "Créer mon compte"}
          </button>
        </form>
        {professional && mode === "register" && (
          <p className="auth-footnote">Votre espace sera activé après validation par l’équipe commerciale BOOKILI.</p>
        )}
        {superAdmin && (
          <p className="auth-footnote">Première installation ? Créez votre compte depuis la <Link to="/gestion-commercial">gestion commerciale</Link>.</p>
        )}
      </section>
    </main>
  );
}

function AdminSetup({ onComplete }) {
  const [csrfToken, setCsrfToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    fetch("/api/csrf.php", { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Le formulaire de configuration est indisponible.");
        setCsrfToken(result.csrfToken);
      })
      .catch(() => setNotice({ kind: "error", text: "Impossible de préparer le formulaire sécurisé. Vérifiez la configuration serveur." }));
  }, []);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setNotice(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/setup-admin.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      });
      const result = await response.json();
      if (!response.ok) {
        setNotice({ kind: "error", text: result.error || "La configuration n’a pas abouti." });
        return;
      }

      form.reset();
      setNotice({ kind: "success", text: result.message });
    } catch {
      setNotice({ kind: "error", text: "Impossible de joindre BOOKILI. Réessayez." });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <Link to="/" className="coming-logo">BOOKILI</Link>
      <section className="auth-card" aria-labelledby="setup-title">
        <p className="eyebrow">PREMIÈRE CONFIGURATION</p>
        <h1 id="setup-title">Créer le super-admin</h1>
        <p className="auth-description">
          Cette étape ne peut être effectuée qu’une seule fois. Utilisez la clé
          secrète configurée hors du dossier public de votre hébergement.
        </p>
        {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
        {notice?.kind === "success" ? (
          <button className="auth-submit" type="button" onClick={onComplete}>Aller à la connexion</button>
        ) : (
        <form className="auth-form" onSubmit={submit}>
          <label>Clé de configuration
            <input name="setupToken" type="password" required minLength={64} maxLength={256} autoComplete="off" />
          </label>
          <label>Adresse e-mail administrateur
            <input name="email" type="email" required maxLength={254} autoComplete="email" />
          </label>
          <label>Mot de passe administrateur
            <input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" />
            <span className="field-hint">Au moins 12 caractères.</span>
          </label>
          <button className="auth-submit" type="submit" disabled={!csrfToken || isSubmitting}>
            {isSubmitting ? "Configuration…" : "Créer le super-admin"}
          </button>
        </form>
        )}
        <p className="auth-footnote">Après la création, retirez la clé du fichier de configuration cPanel.</p>
      </section>
    </main>
  );
}

function CommercialGate() {
  const [setupStatus, setSetupStatus] = useState("loading");
  const [setupError, setSetupError] = useState("");
  const [access, setAccess] = useState({ status: "loading", account: null, csrfToken: "" });

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch("/api/setup-status.php", { credentials: "same-origin" }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Configuration du serveur indisponible.");
        return result;
      }),
      fetch("/api/session.php", { credentials: "same-origin" }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Session indisponible.");
        return result;
      }),
    ])
      .then(([setup, session]) => {
        if (!active) return;
        setSetupStatus(setup.setupAvailable ? "available" : setup.setupRequired ? "not-configured" : "complete");
        if (session.authenticated && ["commercial", "super_admin"].includes(session.account?.role)) {
          setAccess({ status: "authorized", account: session.account, csrfToken: session.csrfToken });
        } else {
          setAccess({ status: "login", account: null, csrfToken: session.csrfToken || "" });
        }
      })
      .catch((error) => {
        if (!active) return;
        setSetupError(error.message);
        setSetupStatus("error");
        setAccess({ status: "login", account: null, csrfToken: "" });
      });
    return () => { active = false; };
  }, []);

  if (setupStatus === "loading" || access.status === "loading") {
    return <main className="coming-page"><p className="coming-logo">BOOKILI</p><p className="auth-description">Chargement de la gestion commerciale…</p></main>;
  }

  if (setupStatus === "error") {
    return (
      <main className="coming-page">
        <Link to="/" className="coming-logo">BOOKILI</Link>
        <section className="coming-card">
          <p className="eyebrow">GESTION COMMERCIALE</p>
          <h1>Gestion commerciale indisponible</h1>
          <p>{setupError}</p>
          <p>Vérifiez la configuration MySQL et le schéma de la base dans cPanel.</p>
        </section>
      </main>
    );
  }

  if (setupStatus === "not-configured") {
    return (
      <main className="coming-page">
        <Link to="/" className="coming-logo">BOOKILI</Link>
        <section className="coming-card">
          <p className="eyebrow">GESTION COMMERCIALE</p>
          <h1>Configuration initiale nécessaire</h1>
          <p>Ajoutez une clé secrète dans le fichier de configuration du serveur avant de créer le premier super-admin. Consultez les instructions d’installation dans le README.</p>
        </section>
      </main>
    );
  }

  if (setupStatus === "available") {
    return <AdminSetup onComplete={() => setSetupStatus("complete")} />;
  }

  if (access.status === "authorized") {
    return (
      <CommercialDashboard
        account={access.account}
        csrfToken={access.csrfToken}
        onLogout={() => setAccess({ status: "login", account: null, csrfToken: "" })}
      />
    );
  }

  return (
    <AuthPage
      commercial
      onAuthenticated={(account, csrfToken) => setAccess({ status: "authorized", account, csrfToken })}
    />
  );
}

function CommercialDashboard({ account, csrfToken, onLogout }) {
  const [filter, setFilter] = useState("pending");
  const [applications, setApplications] = useState([]);
  const [reviewNotes, setReviewNotes] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [workingId, setWorkingId] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function loadApplications() {
    setIsLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/commercial-applications.php?status=${encodeURIComponent(filter)}`, {
        credentials: "same-origin",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Impossible de charger les demandes.");
      setApplications(result.applications);
    } catch (cause) {
      setError(cause.message || "Impossible de joindre BOOKILI.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadApplications();
  }, [filter]);

  async function reviewApplication(applicationId, decision) {
    setWorkingId(applicationId);
    setNotice("");
    setError("");
    try {
      const response = await fetch("/api/review-application.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ applicationId, decision, reviewNote: reviewNotes[applicationId] || "" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "La demande n’a pas pu être mise à jour.");
      setReviewNotes((notes) => {
        const updated = { ...notes };
        delete updated[applicationId];
        return updated;
      });
      setNotice(decision === "approve" ? "Demande validée. Le compte professionnel est activé." : "Demande refusée. Le compte professionnel est suspendu.");
      await loadApplications();
    } catch (cause) {
      setError(cause.message || "Impossible de joindre BOOKILI.");
    } finally {
      setWorkingId(null);
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/logout.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!response.ok) throw new Error("La déconnexion n’a pas abouti.");
      onLogout();
    } catch (cause) {
      setError(cause.message || "Impossible de joindre BOOKILI.");
    }
  }

  return (
    <main className="commercial-page">
      <header className="commercial-header">
        <Link className="logo" to="/">BOOKILI</Link>
        <div className="commercial-user">
          <span>{account.email}</span>
          {account.role === "super_admin" && <Link className="admin-nav-link" to="/super-admin">Super-admin</Link>}
          <button type="button" onClick={logout}>Se déconnecter</button>
        </div>
      </header>
      <section className="commercial-content">
        <div className="commercial-title">
          <div>
            <p className="eyebrow">ESPACE ÉQUIPE</p>
            <h1>Gestion commerciale</h1>
            <p>Examinez et traitez les inscriptions des professionnels.</p>
          </div>
          <label className="application-filter">Afficher
            <select value={filter} onChange={(event) => setFilter(event.target.value)}>
              <option value="pending">À traiter</option>
              <option value="submitted">Soumises</option>
              <option value="in_review">En examen</option>
              <option value="approved">Validées</option>
              <option value="rejected">Refusées</option>
            </select>
          </label>
        </div>
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {notice && <p className="form-message form-success" role="status">{notice}</p>}
        {isLoading ? <p className="commercial-empty">Chargement des demandes…</p> : applications.length === 0 ? (
          <p className="commercial-empty">Aucune demande dans cette catégorie.</p>
        ) : (
          <div className="application-list">
            {applications.map((application) => (
              <article className="application-card" key={application.id}>
                <div className="application-heading">
                  <div>
                    <p className={`application-status status-${application.status}`}>{{
                      submitted: "Soumise",
                      in_review: "En examen",
                      approved: "Validée",
                      rejected: "Refusée",
                    }[application.status]}</p>
                    <h2>{application.business_name}</h2>
                    <p>{application.contact_name} · {beautyCategories.find(({ value }) => value === application.business_category)?.label || application.business_category}</p>
                  </div>
                  <time>{application.submitted_at}</time>
                </div>
                <div className="application-details">
                  <a href={`mailto:${application.email}`}>{application.email}</a>
                  <a href={`tel:${application.phone_number}`}>{application.phone_number}</a>
                  <span>{application.city}, {getWilayaName(application.wilaya_code) || application.wilaya_code}</span>
                  <span>{application.address}</span>
                </div>
                {application.review_note && <p className="application-note">Note : {application.review_note}</p>}
                {["submitted", "in_review"].includes(application.status) && (
                  <div className="review-controls">
                    <label>Note de suivi (facultative)
                      <textarea value={reviewNotes[application.id] || ""} onChange={(event) => setReviewNotes((notes) => ({ ...notes, [application.id]: event.target.value }))} maxLength={1000} rows={2} />
                    </label>
                    <div className="review-buttons">
                      <button type="button" className="review-reject" disabled={workingId !== null} onClick={() => reviewApplication(application.id, "reject")}>
                        Refuser
                      </button>
                      <button type="button" className="review-approve" disabled={workingId !== null} onClick={() => reviewApplication(application.id, "approve")}>
                        {workingId === application.id ? "Traitement…" : "Valider la demande"}
                      </button>
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function SuperAdmin() {
  const [access, setAccess] = useState({ status: "loading", account: null, csrfToken: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/session.php", { credentials: "same-origin" })
      .then(async (response) => {
        const session = await response.json();
        if (!response.ok) throw new Error(session.error || "Session indisponible.");
        if (active) {
          setAccess(session.authenticated && session.account?.role === "super_admin"
            ? { status: "authorized", account: session.account, csrfToken: session.csrfToken }
            : { status: "login", account: null, csrfToken: "" });
        }
      })
      .catch((cause) => {
        if (active) {
          setError(cause.message || "Impossible de joindre BOOKILI.");
          setAccess({ status: "error", account: null, csrfToken: "" });
        }
      });
    return () => { active = false; };
  }, []);

  if (access.status === "loading") {
    return <main className="coming-page"><Link to="/" className="coming-logo">BOOKILI</Link><p>Chargement de l’espace super-admin…</p></main>;
  }
  if (access.status === "error") {
    return <main className="coming-page"><Link to="/" className="coming-logo">BOOKILI</Link><p className="form-message form-error" role="alert">{error}</p></main>;
  }
  if (access.status === "login") {
    return <AuthPage superAdmin onAuthenticated={(account, csrfToken) => setAccess({ status: "authorized", account, csrfToken })} />;
  }
  return <SuperAdminDashboard account={access.account} csrfToken={access.csrfToken} onLogout={() => setAccess({ status: "login", account: null, csrfToken: "" })} />;
}

function SuperAdminDashboard({ account, csrfToken, onLogout }) {
  const [hasImage, setHasImage] = useState(false);
  const [imageVersion, setImageVersion] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [imageReady, setImageReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    let active = true;
    fetch("/api/admin-homepage-image.php", { credentials: "same-origin" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Impossible de charger l’image.");
        if (active) {
          setHasImage(result.hasImage);
          setImageReady(true);
        }
      })
      .catch((cause) => {
        if (active) setNotice({ kind: "error", text: cause.message || "Impossible de joindre BOOKILI." });
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function updateImage(formData, form) {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin-homepage-image.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken },
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "La modification n’a pas abouti.");
      setHasImage(result.hasImage);
      setImageVersion(Date.now());
      if (form) form.reset();
      setNotice({ kind: "success", text: result.message });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message || "Impossible de joindre BOOKILI." });
    } finally {
      setSaving(false);
    }
  }

  function upload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    data.set("action", "upload");
    updateImage(data, form);
  }

  function remove() {
    if (!window.confirm("Supprimer l’image et rétablir le fond gris ?")) return;
    const data = new FormData();
    data.set("action", "remove");
    updateImage(data);
  }

  async function logout() {
    try {
      const response = await fetch("/api/logout.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!response.ok) throw new Error("La déconnexion n’a pas abouti.");
      onLogout();
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message || "Impossible de joindre BOOKILI." });
    }
  }

  return (
    <main className="client-page">
      <header className="commercial-header">
        <Link className="logo" to="/">BOOKILI</Link>
        <div className="commercial-user">
          <span>{account.email}</span>
          <Link className="admin-nav-link" to="/gestion-commercial">Gestion commerciale</Link>
          <button type="button" onClick={logout}>Se déconnecter</button>
        </div>
      </header>
      <div className="client-content">
        <p className="eyebrow">SUPER-ADMIN</p>
        <h1>Page d’accueil</h1>
        <section className="client-card" aria-labelledby="homepage-image-title">
          <h2 id="homepage-image-title">Image de couverture</h2>
          <p>Choisissez l’image affichée en haut du site. Sans image, le fond reste gris.</p>
          {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
          {loading ? <p>Chargement…</p> : imageReady && (
            <>
              <div className="admin-image-preview">
                {hasImage ? <img src={`/api/homepage-image.php?v=${imageVersion}`} alt="Image actuelle de la page d’accueil" /> : <span>Fond gris par défaut</span>}
              </div>
              <form className="auth-form" onSubmit={upload}>
                <label>Choisir une image
                  <input type="file" name="image" accept="image/jpeg,image/png,image/webp" required />
                  <span className="field-hint">JPEG, PNG ou WebP · 2 Mo maximum · 8 mégapixels maximum.</span>
                </label>
                <button className="auth-submit" type="submit" disabled={saving || !csrfToken}>
                  {saving ? "Enregistrement…" : hasImage ? "Remplacer l’image" : "Ajouter l’image"}
                </button>
              </form>
              {hasImage && <button className="admin-remove" type="button" onClick={remove} disabled={saving}>Supprimer l’image</button>}
            </>
          )}
        </section>
      </div>
    </main>
  );
}

function ClientAccount() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [phone, setPhone] = useState("");
  const [csrfToken, setCsrfToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [phoneNotice, setPhoneNotice] = useState(null);
  const [passwordNotice, setPasswordNotice] = useState(null);
  const [savingPhone, setSavingPhone] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const sessionResponse = await fetch("/api/session.php", { credentials: "same-origin" });
        const session = await sessionResponse.json();
        if (!sessionResponse.ok) throw new Error(session.error || "Session indisponible.");
        if (!session.authenticated || session.account?.role !== "client") {
          navigate("/compte", { replace: true });
          return;
        }
        const response = await fetch("/api/client-profile.php", { credentials: "same-origin" });
        const result = await response.json();
        if (response.status === 401) {
          navigate("/compte", { replace: true });
          return;
        }
        if (!response.ok) throw new Error(result.error || "Impossible de charger votre compte.");
        if (active) {
          setProfile({ ...result.profile, email: result.email });
          setPhone(result.profile.phone_number);
          setCsrfToken(session.csrfToken);
        }
      } catch (cause) {
        if (active) setError(cause.message || "Impossible de joindre BOOKILI.");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => { active = false; };
  }, [navigate]);

  async function submitPhone(event) {
    event.preventDefault();
    setPhoneNotice(null);
    setSavingPhone(true);
    try {
      const response = await fetch("/api/client-profile.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify({ phone }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Impossible de modifier votre téléphone.");
      setProfile({ ...result.profile, email: result.email });
      setPhone(result.profile.phone_number);
      setPhoneNotice({ kind: "success", text: "Votre numéro de téléphone a été modifié." });
    } catch (cause) {
      setPhoneNotice({ kind: "error", text: cause.message || "Impossible de joindre BOOKILI." });
    } finally {
      setSavingPhone(false);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setPasswordNotice(null);
    setSavingPassword(true);
    try {
      const response = await fetch("/api/client-password.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Impossible de modifier votre mot de passe.");
      form.reset();
      setPasswordNotice({ kind: "success", text: result.message });
    } catch (cause) {
      setPasswordNotice({ kind: "error", text: cause.message || "Impossible de joindre BOOKILI." });
    } finally {
      setSavingPassword(false);
    }
  }

  async function logout() {
    try {
      const response = await fetch("/api/logout.php", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken },
      });
      if (!response.ok) throw new Error("La déconnexion n’a pas abouti. Rechargez la page et réessayez.");
      navigate("/compte", { replace: true });
    } catch (cause) {
      setError(cause.message || "Impossible de joindre BOOKILI.");
    }
  }

  return (
    <main className="client-page">
      <header className="commercial-header">
        <Link className="logo" to="/">BOOKILI</Link>
        {profile && <div className="commercial-user"><button type="button" onClick={logout}>Se déconnecter</button></div>}
      </header>
      <div className="client-content">
        <p className="eyebrow">ESPACE CLIENT</p>
        <h1>Mon compte</h1>
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {loading && <p>Chargement de votre compte…</p>}
        {profile && (
          <>
            <Appointments csrfToken={csrfToken} />
            <section className="client-card" aria-labelledby="client-profile-title">
              <h2 id="client-profile-title">Mes informations</h2>
              <dl className="client-details">
                <div><dt>Nom et prénom</dt><dd>{profile.last_name} {profile.first_name}</dd></div>
                <div><dt>Adresse e-mail</dt><dd>{profile.email}</dd></div>
                <div><dt>Date de naissance</dt><dd>{profile.date_of_birth.split("-").reverse().join("/")}</dd></div>
              </dl>
              {phoneNotice && <p className={`form-message form-${phoneNotice.kind}`} role={phoneNotice.kind === "error" ? "alert" : "status"}>{phoneNotice.text}</p>}
              <form className="auth-form" onSubmit={submitPhone}>
                <label>Numéro de téléphone
                  <input name="phone" type="tel" required autoComplete="tel" inputMode="tel" maxLength={24} value={phone} onChange={(event) => setPhone(event.target.value)} />
                </label>
                <button className="auth-submit" type="submit" disabled={!csrfToken || savingPhone}>
                  {savingPhone ? "Enregistrement…" : "Enregistrer le numéro"}
                </button>
              </form>
            </section>
            <section className="client-card" aria-labelledby="client-password-title">
              <h2 id="client-password-title">Modifier mon mot de passe</h2>
              {passwordNotice && <p className={`form-message form-${passwordNotice.kind}`} role={passwordNotice.kind === "error" ? "alert" : "status"}>{passwordNotice.text}</p>}
              <form className="auth-form" onSubmit={submitPassword}>
                <label>Mot de passe actuel
                  <input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
                </label>
                <label>Nouveau mot de passe
                  <input name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={72} />
                  <span className="field-hint">Au moins 12 caractères et 72 octets maximum.</span>
                </label>
                <label>Confirmer le nouveau mot de passe
                  <input name="confirmPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={72} />
                </label>
                <button className="auth-submit" type="submit" disabled={!csrfToken || savingPassword}>
                  {savingPassword ? "Enregistrement…" : "Modifier le mot de passe"}
                </button>
              </form>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/recherche" element={<SearchResults />} />
      <Route path="/salons/:salonId" element={<SalonPage />} />
      <Route path="/professionnels" element={<AuthPage professional />} />
      <Route path="/compte" element={<AuthPage />} />
      <Route path="/gestion-commercial" element={<CommercialGate />} />
      <Route path="/super-admin" element={<SuperAdmin />} />
      <Route path="/espace-client" element={<ClientAccount />} />
      <Route path="/espace-professionnel" element={<ProfessionalSpace />} />
      <Route path="*" element={<ComingSoon audience="PAGE INTROUVABLE" title="Cette page n’existe pas" description="Vérifiez l’adresse ou retournez à l’accueil de BOOKILI." />} />
    </Routes>
  );
}
