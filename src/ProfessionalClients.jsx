import { useEffect, useState } from "react";
import { apiRequest, appointmentDate, priceLabel } from "./api-client.js";

const paymentNames = {
  cash: "Espèces", card: "Carte", transfer: "Virement", other: "Autre", gift_card: "Carte cadeau",
};

function Feedback({ notice }) {
  if (!notice) return null;
  return <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>;
}

export default function ProfessionalClients({ csrfToken }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), q: query });
    setResult(null);
    setError("");
    apiRequest(`professional-clients.php?${params}`, { signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [page, query]);

  function submitSearch(event) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
    setSelectedId(null);
  }

  return <section className="client-card">
    <header className="client-directory-header">
      <div>
        <h2>Fichier clients</h2>
        <p>Coordonnées, rendez-vous et notes privées de votre établissement.</p>
      </div>
      {result && <strong>{result.total} client(s)</strong>}
    </header>
    <form className="client-directory-search" onSubmit={submitSearch}>
      <label htmlFor="client-directory-query">Rechercher un client</label>
      <input id="client-directory-query" value={search} maxLength={120} placeholder="Nom, téléphone ou e-mail" onChange={(event) => setSearch(event.target.value)} />
      <button className="admin-nav-link" type="submit">Rechercher</button>
      {query && <button className="admin-nav-link" type="button" onClick={() => {
        setSearch("");
        setQuery("");
        setPage(1);
        setSelectedId(null);
      }}>Effacer</button>}
    </form>
    <p className="field-hint">La liste comprend les clients ayant au moins un rendez-vous confirmé. Les fiches et notes ne sont visibles que par votre établissement.</p>
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!result && !error && <p role="status">Chargement des clients…</p>}
    {result?.clients.length === 0 && <p>Aucun client ne correspond à cette recherche.</p>}
    <div className="service-list">
      {result?.clients.map((client) => <article className="service-row client-directory-row" key={client.id}>
        <div>
          <strong>{client.first_name} {client.last_name}</strong>
          <span>{client.phone_number} · {client.email}</span>
          <small>{client.appointment_count} rendez-vous · Dernière visite : {client.latest_visit ? appointmentDate(client.latest_visit) : "Aucune visite passée"}</small>
        </div>
        <div className="client-directory-actions">
          <a className="admin-nav-link" href={`tel:${client.phone_number}`}>Appeler</a>
          <button className="admin-nav-link" type="button" aria-expanded={Number(selectedId) === client.id} onClick={() => {
            setSelectedId(Number(selectedId) === client.id ? null : client.id);
          }}>{Number(selectedId) === client.id ? "Fermer la fiche" : "Ouvrir la fiche"}</button>
        </div>
      </article>)}
    </div>
    {result && <nav className="pagination" aria-label="Pages du fichier clients">
      {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
      {result.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
    </nav>}
    {selectedId !== null && <div className="client-profile-panel">
      <ClientProfile key={selectedId} clientId={selectedId} csrfToken={csrfToken} />
    </div>}
  </section>;
}

export function ClientProfile({ clientId, csrfToken }) {
  const [historyPage, setHistoryPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ clientId: String(clientId), historyPage: String(historyPage) });
    setDetail(null);
    setError("");
    apiRequest(`professional-clients.php?${params}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setDetail(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [clientId, historyPage, revision]);

  return <>
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!detail && !error && <p role="status">Chargement de la fiche client…</p>}
    {detail && <ClientDetail
      key={detail.client.id}
      csrfToken={csrfToken}
      detail={detail}
      historyPage={historyPage}
      onHistoryPage={setHistoryPage}
      onNoteSaved={() => setRevision((value) => value + 1)}
    />}
  </>;
}

function ClientDetail({ csrfToken, detail, historyPage, onHistoryPage, onNoteSaved }) {
  const { client, appointments, hasMoreHistory } = detail;
  const [note, setNote] = useState(client.private_note);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => setNote(client.private_note), [client.id, client.private_note_updated_at]);

  async function saveNote(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-clients.php", {
        csrfToken,
        body: { action: "save_note", clientId: client.id, note },
      });
      setNotice({ kind: "success", text: result.message });
      onNoteSaved();
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally { setSaving(false); }
  }

  return <section className="client-profile">
    <header className="client-profile-heading">
      <div>
        <p className="eyebrow">Fiche client</p>
        <h3>{client.first_name} {client.last_name}</h3>
      </div>
      <a className="admin-nav-link" href={`mailto:${client.email}`}>Envoyer un e-mail</a>
    </header>
    <div className="client-profile-grid">
      <article><span>Téléphone</span><a href={`tel:${client.phone_number}`}>{client.phone_number}</a></article>
      <article><span>E-mail</span><a href={`mailto:${client.email}`}>{client.email}</a></article>
      <article><span>Date de naissance</span><strong>{client.date_of_birth.split("-").reverse().join("/")}</strong></article>
      <article><span>Rendez-vous</span><strong>{client.appointment_count} au total · {client.confirmed_count} confirmé(s) · {client.cancelled_count} annulé(s)</strong></article>
      <article><span>Dernière visite confirmée passée</span><strong>{client.latest_visit ? appointmentDate(client.latest_visit) : "Aucune"}</strong></article>
      <article><span>Prochain rendez-vous</span><strong>{client.next_appointment ? appointmentDate(client.next_appointment) : "Aucun"}</strong></article>
      <article><span>Ventes liées aux rendez-vous</span><strong>{priceLabel(client.total_spent_dzd)}</strong></article>
    </div>
    <form className="client-private-note" onSubmit={saveNote}>
      <label htmlFor={`client-note-${client.id}`}>Note privée permanente</label>
      <p className="field-hint">Visible uniquement par les professionnels de votre établissement. La note n’est pas visible par le client ni par les autres salons.</p>
      <textarea id={`client-note-${client.id}`} rows={5} maxLength={4000} value={note} disabled={saving} onChange={(event) => setNote(event.target.value)} />
      <div className="client-note-footer">
        <span>{new TextEncoder().encode(note).length} / 4 000 octets{client.private_note_updated_at && ` · Modifiée le ${appointmentDate(client.private_note_updated_at)}`}</span>
        <button className="admin-nav-link" type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer la note"}</button>
      </div>
      <Feedback notice={notice} />
    </form>
    <section className="client-appointment-history">
      <h4>Historique des rendez-vous</h4>
      {appointments.length === 0 && <p>Aucun rendez-vous dans cette fiche.</p>}
      <div className="appointment-list">
        {appointments.map((appointment) => <article className="appointment-card" key={appointment.id}>
          <header className="client-history-heading">
            <strong>{appointmentDate(appointment.starts_at)}</strong>
            <span className={`client-status-${appointment.status}`}>{appointment.status === "cancelled" ? "Annulé" : "Confirmé"}</span>
          </header>
          <p>{appointment.service_name} · {priceLabel(appointment.price_dzd)}</p>
          {appointment.private_note && <p className="client-appointment-note"><strong>Note privée du rendez-vous :</strong> {appointment.private_note}</p>}
          {appointment.sale_total_dzd !== null && <p className="field-hint">{appointment.voided_at ? "Vente annulée" : `Vente liée : ${priceLabel(appointment.sale_total_dzd)}${appointment.payment_method ? ` · ${paymentNames[appointment.payment_method] || appointment.payment_method}` : ""}`}</p>}
        </article>)}
      </div>
      <nav className="pagination" aria-label="Pages de l’historique client">
        {historyPage > 1 && <button className="admin-nav-link" type="button" onClick={() => onHistoryPage(historyPage - 1)}>Rendez-vous plus récents</button>}
        {hasMoreHistory && <button className="admin-nav-link" type="button" onClick={() => onHistoryPage(historyPage + 1)}>Rendez-vous plus anciens</button>}
      </nav>
    </section>
  </section>;
}
