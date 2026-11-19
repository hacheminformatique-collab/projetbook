import { useEffect, useState } from "react";
import { apiRequest } from "./api-client.js";

const defaults = {
  showTime: true,
  showClient: true,
  showServices: true,
  showNote: true,
  showAddButton: true,
};

const options = [
  ["showTime", "Horaires du rendez-vous"],
  ["showClient", "Nom du client"],
  ["showServices", "Prestation(s)"],
  ["showNote", "Note privée du rendez-vous"],
];

export default function AgendaDisplaySettings({ csrfToken }) {
  const [settings, setSettings] = useState(defaults);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest("professional-agenda-settings.php", { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) {
          setSettings(response.settings);
          setLoaded(true);
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted) {
          setNotice({ kind: "error", text: cause.message });
        }
      });
    return () => controller.abort();
  }, []);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const response = await apiRequest("professional-agenda-settings.php", {
        csrfToken,
        body: { settings },
      });
      setSettings(response.settings);
      setNotice({ kind: "success", text: response.message });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally { setSaving(false); }
  }

  return <section className="client-card agenda-display-settings">
    <header>
      <div>
        <h2>Affichage des rendez-vous</h2>
        <p>Choisissez les informations visibles dans les blocs de l’agenda. Les détails complets restent accessibles en ouvrant chaque rendez-vous.</p>
      </div>
      <button className="auth-submit" type="submit" form="agenda-display-form" disabled={!loaded || saving}>
        {saving ? "Enregistrement…" : "Enregistrer"}
      </button>
    </header>
    {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    {!loaded && <p role="status">Chargement des préférences…</p>}
    {loaded && <form id="agenda-display-form" onSubmit={submit}>
      <div className="agenda-display-layout">
        <fieldset className="agenda-display-options" disabled={saving}>
          <legend>Informations dans le bloc rendez-vous</legend>
          {options.map(([key, label]) => <label key={key}>
            <span>{label}</span>
            <select value={settings[key] ? "yes" : "no"} onChange={(event) => {
              setSettings((current) => ({ ...current, [key]: event.target.value === "yes" }));
            }}>
              <option value="yes">Afficher</option>
              <option value="no">Masquer</option>
            </select>
          </label>)}
          <label>
            <span>Bouton + de création rapide dans l’agenda</span>
            <select value={settings.showAddButton ? "yes" : "no"} onChange={(event) => {
              setSettings((current) => ({ ...current, showAddButton: event.target.value === "yes" }));
            }}>
              <option value="yes">Afficher</option>
              <option value="no">Masquer</option>
            </select>
          </label>
        </fieldset>
        <section className="agenda-display-preview" aria-label="Aperçu d’un rendez-vous">
          <span>Aperçu</span>
          <article className="agenda-booking-preview">
            {settings.showTime && <strong>10:00–10:30</strong>}
            {settings.showClient && <span>Nom du client</span>}
            {settings.showServices && <span>Prestation</span>}
            {settings.showNote && <small>Note privée</small>}
            {!options.some(([key]) => settings[key]) && <span>Rendez-vous</span>}
          </article>
          <small>{settings.showAddButton ? "Le bouton + sera visible dans l’agenda." : "La création reste possible depuis un créneau libre."}</small>
        </section>
      </div>
    </form>}
  </section>;
}
