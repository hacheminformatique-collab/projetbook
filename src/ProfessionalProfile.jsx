import { useEffect, useState } from "react";
import { apiRequest } from "./api-client.js";

const categories = [
  ["access", "Accès"],
  ["training", "Formations"],
  ["experience", "Expériences"],
];
const statusLabels = {
  pending: "En attente de validation",
  approved: "Validé",
  rejected: "Refusé — modifiez puis soumettez à nouveau",
};

function EntryForm({ category, disabled, onAdd }) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setSaving(true);
    setNotice("");
    try {
      await onAdd(category, fields.get("title"), fields.get("details"));
      form.reset();
    } catch (cause) {
      setNotice(cause.message);
    } finally {
      setSaving(false);
    }
  }

  return <form className="auth-form profile-entry-form" onSubmit={submit}>
    {notice && <p className="form-message form-error" role="alert">{notice}</p>}
    <label>Titre<input name="title" required maxLength={120} /></label>
    <label>Description<textarea name="details" maxLength={1000} rows={2} /></label>
    <button className="admin-nav-link" type="submit" disabled={disabled || saving}>{saving ? "Envoi…" : "Ajouter pour validation"}</button>
  </form>;
}

export default function ProfessionalProfile({ csrfToken, onOpenPhotos }) {
  const [profile, setProfile] = useState(null);
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState(null);

  async function load(signal) {
    const result = await apiRequest("professional-salon-profile.php", { signal });
    setProfile(result);
    setDescription(result.salon.profile_description || "");
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  async function saveDescription(event) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-salon-profile.php", {
        csrfToken, body: { action: "save-description", description },
      });
      setProfile(result);
      setDescription(result.salon.profile_description || "");
      setNotice({ kind: "success", text: result.salon.profile_description_status === "draft"
        ? "Le descriptif a été retiré de la file de validation."
        : "Le descriptif a été envoyé à l’équipe pour validation. La version publiée reste inchangée jusque-là." });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      setWorking(false);
    }
  }

  async function addEntry(category, title, details) {
    const result = await apiRequest("professional-salon-profile.php", {
      csrfToken, body: { action: "add-entry", category, title, details },
    });
    setProfile(result);
  }

  async function deleteEntry(entry) {
    if (!window.confirm(`Supprimer « ${entry.title} » de votre descriptif ?`)) return;
    setWorking(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-salon-profile.php", {
        csrfToken, body: { action: "delete-entry", entryId: Number(entry.id) },
      });
      setProfile(result);
      setNotice({ kind: "success", text: "La rubrique a été supprimée." });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      setWorking(false);
    }
  }

  return <section className="client-card">
    <div className="client-directory-header">
      <h2>Descriptif établissement</h2>
      <button className="admin-nav-link" type="button" onClick={onOpenPhotos}>Gestion des photos →</button>
    </div>
    <p className="field-hint">Présentez votre établissement. Chaque modification est vérifiée par BOOKILI avant d’être publiée.</p>
    {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    {loading && <p role="status">Chargement du descriptif…</p>}
    {!loading && profile && <>
      <div className="profile-description-grid">
        <section className="profile-description-card profile-description-public" aria-labelledby="profile-public-title">
          <h3 id="profile-public-title">Version publiée</h3>
          {Number(profile.salon.is_public) === 0 && <p className="field-hint">Votre fiche est masquée : ce texte n’est pas visible par les clients.</p>}
          {profile.salon.public_description
            ? <p className="profile-published-text">{profile.salon.public_description}</p>
            : <p className="field-hint">Aucun descriptif n’est actuellement publié.</p>}
        </section>
        <form className="auth-form profile-description-card profile-description-edit" onSubmit={saveDescription}>
          <div>
            <h3>Version à modifier</h3>
            <p className={`profile-description-status profile-description-status-${profile.salon.profile_description_status}`}>
              {statusLabels[profile.salon.profile_description_status] || "Brouillon"}
            </p>
          </div>
          <label>À-propos<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={6} /></label>
          <p className="field-hint">{description.length} / 2 000 caractères · Le texte publié reste inchangé jusqu’à validation.</p>
          <button className="auth-submit" type="submit" disabled={working}>{working ? "Enregistrement…" : "Envoyer le descriptif"}</button>
        </form>
      </div>
      {categories.map(([category, label]) => {
        const entries = profile.entries.filter((entry) => entry.category === category);
        return <section className="profile-category" key={category}>
          <h3>{label}</h3>
          {entries.length === 0 && <p className="field-hint">Aucune rubrique ajoutée.</p>}
          <div className="service-list">
            {entries.map((entry) => <article className="service-row" key={entry.id}>
              <span><strong>{entry.title}</strong><br />{entry.details || "Aucun détail"}<br /><span className="field-hint">{statusLabels[entry.status]}</span></span>
              <button className="admin-nav-link" type="button" disabled={working} onClick={() => deleteEntry(entry)}>Supprimer</button>
            </article>)}
          </div>
          <details className="profile-entry-details">
            <summary>Ajouter une rubrique · {label}</summary>
            <EntryForm category={category} disabled={working} onAdd={addEntry} />
          </details>
        </section>;
      })}
    </>}
  </section>;
}
