import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { apiRequest } from "./api-client.js";

export default function PasswordReset({ confirm = false }) {
  const [query] = useSearchParams();
  const { hash } = useLocation();
  const fragment = new URLSearchParams(hash.slice(1));
  const portal = (confirm ? fragment : query).get("espace") === "professionnels" ? "/professionnels" : "/compte";
  const token = fragment.get("token") || "";
  const validLink = !confirm || /^[a-f0-9]{64}$/.test(token);
  const [csrfToken, setCsrfToken] = useState("");
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!validLink) return;
    const controller = new AbortController();
    apiRequest("csrf.php", { signal: controller.signal })
      .then((response) => setCsrfToken(response.csrfToken))
      .catch((error) => { if (!controller.signal.aborted) setNotice({ error: true, text: error.message }); });
    return () => controller.abort();
  }, [validLink]);

  async function submit(event) {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiRequest("password-reset.php", {
        csrfToken, body: { ...fields, action: confirm ? "reset" : "request", ...(confirm ? { token } : {}) },
      });
      setNotice({ text: response.message });
      setDone(true);
    } catch (error) {
      setNotice({ error: true, text: error.message });
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <Link className="coming-logo" to="/">BOOKILI</Link>
    <section className="auth-card" aria-labelledby="password-reset-title">
      <h1 id="password-reset-title">{confirm ? "Choisir un nouveau mot de passe" : "Mot de passe oublié ?"}</h1>
      {!validLink && <p className="form-message form-error" role="alert">Ce lien est incomplet ou invalide.</p>}
      {notice && <p className={`form-message ${notice.error ? "form-error" : "form-success"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      {validLink && !done && <form className="auth-form" onSubmit={submit}>
        {confirm ? <>
          <label>Nouveau mot de passe<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
          <label>Confirmer le mot de passe<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={72} required /></label>
        </> : <label>Adresse e-mail du compte<input name="email" type="email" autoComplete="email" maxLength={254} required /></label>}
        <button className="auth-submit" type="submit" disabled={!csrfToken || busy}>{busy ? "Veuillez patienter…" : confirm ? "Changer mon mot de passe" : "Recevoir un lien"}</button>
      </form>}
      {confirm && !done && <p className="auth-footnote"><Link to={`/mot-de-passe-oublie?espace=${portal.slice(1)}`}>Demander un nouveau lien</Link></p>}
      <p className="auth-footnote"><Link to={portal}>Retour à la connexion</Link></p>
    </section>
  </main>;
}
