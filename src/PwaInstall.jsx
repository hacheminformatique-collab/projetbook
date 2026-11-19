import { useState } from "react";
import { Link, Navigate } from "react-router-dom";

const baseUrl = import.meta.env.BASE_URL;
const pagePath = window.location.pathname.slice(baseUrl.length).replace(/\/+$/, "");
const professional = ["installer/pro", "professionnels", "espace-professionnel"].includes(pagePath);
const installPage = pagePath === "installer/client" || pagePath === "installer/pro";
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const appIcon = (pro) => `${baseUrl}bookili-${pro ? "pro" : "client"}-192.png`;

let installPrompt;
let installed = false;
if (installPage) {
  document.title = professional ? "BOOKILI Pro" : "BOOKILI Client";
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = undefined;
    installed = true;
  });
}

for (const [rel, href] of [
  ["manifest", `${baseUrl}bookili${professional ? "-pro" : ""}.webmanifest`],
  ["apple-touch-icon", appIcon(professional)],
]) {
  const link = document.createElement("link");
  link.rel = rel;
  link.href = href;
  document.head.append(link);
}

export function InstallLink({ pro = false }) {
  if (standalone()) return null;
  // A fresh document lets the browser discover the correct manifest before prompting.
  return <a className="pwa-install-link" href={`${baseUrl}installer/${pro ? "pro" : "client"}`}>
    <span aria-hidden="true">📱</span> Installer l’application
  </a>;
}

export function InstallPage({ pro = false }) {
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const destination = pro ? "/espace-professionnel" : "/espace-client";
  const name = pro ? "BOOKILI Pro" : "BOOKILI Client";
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (standalone()) return <Navigate to={destination} replace />;

  async function install() {
    if (installed) {
      setNotice("L’application est installée. Retrouvez-la sur votre appareil.");
      return;
    }
    if (!installPrompt) {
      setNotice("L’invitation automatique n’est pas disponible. Suivez les étapes ci-dessous.");
      return;
    }
    const prompt = installPrompt;
    installPrompt = undefined;
    setWorking(true);
    setNotice("");
    try {
      const { outcome } = await prompt.prompt();
      setNotice(outcome === "accepted"
        ? "Installation acceptée. Retrouvez l’application sur votre appareil."
        : "Installation annulée. Vous pouvez aussi passer par le menu du navigateur.");
    } catch (error) {
      console.warn("BOOKILI : l’invitation d’installation a échoué.", error);
      setNotice("Impossible d’afficher l’invitation. Suivez les étapes ci-dessous.");
    } finally {
      setWorking(false);
    }
  }

  return <main className="auth-page">
    <Link to="/" className="coming-logo">BOOKILI</Link>
    <section className="auth-card pwa-guide" aria-labelledby="install-title">
      <img src={appIcon(pro)} width="64" height="64" alt="" />
      <h1 id="install-title">Installer {name}</h1>
      <p>{pro
        ? "Accédez à votre agenda, à vos disponibilités, à vos prestations et à votre fichier clients depuis l’écran d’accueil."
        : "Recherchez un institut, prenez rendez-vous et retrouvez vos réservations depuis l’écran d’accueil."}</p>
      {!ios && window.isSecureContext && <button className="pwa-install-link" type="button" onClick={install} disabled={working}>
        <span aria-hidden="true">📱</span> Installer l’application
      </button>}
      {notice && <p role="status">{notice}</p>}
      {!window.isSecureContext ? <p>L’installation nécessite d’ouvrir BOOKILI avec une adresse sécurisée (HTTPS).</p> : ios
        ? <p>Dans <strong>Safari</strong>, ouvrez le menu <strong>Partager</strong>, puis choisissez <strong>Sur l’écran d’accueil</strong>. Si l’option <strong>Ouvrir comme app web</strong> apparaît, laissez-la activée, puis touchez <strong>Ajouter</strong>.</p>
        : <p>Dans le menu du navigateur, choisissez <strong>Installer l’application</strong> ou <strong>Ajouter à l’écran d’accueil</strong> si l’option est proposée. Sur Android, utilisez Chrome si votre navigateur ne propose pas l’installation.</p>}
      <p className="field-hint">Une connexion Internet reste nécessaire. L’installation n’active pas les notifications sur le téléphone.</p>
      <a className="text-link" href={`${baseUrl}${destination.slice(1)}`}>Continuer sans installer</a>
    </section>
  </main>;
}
