import { useEffect, useRef, useState } from "react";
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
  const profileHeading = useRef(null);
  const opener = useRef(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), q: query });
    setResult(null);
    setError("");
    apiRequest(`professional-clients.php?${params}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [page, query]);

  useEffect(() => {
    if (selectedId !== null) profileHeading.current?.focus();
    else if (restoreFocus.current) {
      restoreFocus.current = false;
      opener.current?.focus();
    }
  }, [selectedId]);

  function closeProfile() {
    restoreFocus.current = true;
    setSelectedId(null);
  }

  function submitSearch(event) {
    event.preventDefault();
    setQuery(search.trim());
    setPage(1);
    setSelectedId(null);
  }

  return <section className={`client-card client-directory${selectedId !== null ? " client-directory-open" : ""}`}>
    <div className="client-directory-list">
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
          <small>{client.appointment_count} rendez-vous · Dernier rendez-vous confirmé passé : {client.latest_visit ? appointmentDate(client.latest_visit) : "Aucun"}</small>
        </div>
        <div className="client-directory-actions">
          <a className="admin-nav-link" href={`tel:${client.phone_number}`}>Appeler</a>
          <button className="admin-nav-link" type="button" aria-expanded={selectedId === client.id} onClick={(event) => {
            if (selectedId === client.id) closeProfile();
            else {
              opener.current = event.currentTarget;
              setSelectedId(client.id);
            }
          }}>{selectedId === client.id ? "Fermer la fiche" : "Ouvrir la fiche"}</button>
        </div>
      </article>)}
    </div>
    {result && <nav className="pagination" aria-label="Pages du fichier clients">
      {page > 1 && <button className="admin-nav-link" type="button" onClick={() => { setSelectedId(null); setPage(page - 1); }}>Précédent</button>}
      {result.hasMore && <button className="admin-nav-link" type="button" onClick={() => { setSelectedId(null); setPage(page + 1); }}>Suivant</button>}
    </nav>}
    </div>
    {selectedId !== null && <section className="client-profile-panel">
      <div className="client-directory-profile-bar">
        <h3 tabIndex={-1} ref={profileHeading}>Fiche client</h3>
        <button className="admin-nav-link" type="button" onClick={closeProfile}>Retour à la liste</button>
      </div>
      <ClientProfile key={selectedId} clientId={selectedId} csrfToken={csrfToken} />
    </section>}
  </section>;
}

export function ClientProfile({ clientId, csrfToken }) {
  const [historyPage, setHistoryPage] = useState(1);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const loaded = detail?.historyPage === historyPage;

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ clientId: String(clientId), historyPage: String(historyPage) });
    setError("");
    apiRequest(`professional-clients.php?${params}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setDetail(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [clientId, historyPage, retry]);

  return <>
    {!detail && error && <Feedback notice={{ kind: "error", text: error }} />}
    {!detail && !error && <p role="status">Chargement de la fiche client…</p>}
    {detail && <ClientDetail
      key={detail.client.id}
      csrfToken={csrfToken}
      detail={detail}
      historyPage={historyPage}
      historyLoading={!loaded && !error}
      historyError={error}
      onHistoryPage={setHistoryPage}
      onRetry={() => setRetry((value) => value + 1)}
    />}
  </>;
}

function ClientDetail({ csrfToken, detail, historyPage, historyLoading, historyError, onHistoryPage, onRetry }) {
  const { client, appointments, hasMoreHistory } = detail;
  const [draft, setDraft] = useState(null);
  const [savedNote, setSavedNote] = useState(null);
  const [active, setActive] = useState("history");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const useSaved = savedNote && (!client.private_note_updated_at || savedNote.updatedAt >= client.private_note_updated_at);
  const note = draft ?? (useSaved ? savedNote.text : client.private_note);
  const updatedAt = useSaved ? savedNote.updatedAt : client.private_note_updated_at;
  const noteBytes = new TextEncoder().encode(note).length;

  async function saveNote(event) {
    event.preventDefault();
    if (saving || noteBytes > 4000) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-clients.php", {
        csrfToken,
        body: { action: "save_note", clientId: client.id, note },
      });
      setSavedNote({ text: note.trim(), updatedAt: result.updatedAt });
      setDraft(null);
      setNotice({ kind: "success", text: result.message });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally { setSaving(false); }
  }

  return <section className="client-profile" data-section={active}>
    <header className="client-profile-heading">
      <div>
        <p className="eyebrow">Fiche client</p>
        <h3>{client.first_name} {client.last_name}</h3>
      </div>
      <div className="client-profile-actions">
        <a className="admin-nav-link" href={`tel:${client.phone_number}`}>Appeler</a>
        <a className="admin-nav-link" href={`mailto:${client.email}`}>Envoyer un e-mail</a>
      </div>
    </header>
    <p className="client-profile-contact">{client.phone_number} · {client.email}</p>
    <div className="client-profile-grid client-profile-summary">
      <article><span>Prochain rendez-vous</span><strong>{client.next_appointment ? appointmentDate(client.next_appointment) : "Aucun"}</strong></article>
      <article><span>Dernière visite avec vente</span><strong>{client.last_paid_visit ? appointmentDate(client.last_paid_visit) : "Aucune"}</strong></article>
      <article><span>Ventes liées aux rendez-vous</span><strong>{priceLabel(client.total_spent_dzd)}</strong></article>
    </div>
    <div className="client-profile-switch" role="group" aria-label="Rubriques de la fiche client">
      {[["history", "Historique"], ["note", "Note privée"], ["info", "Infos"]].map(([value, label]) =>
        <button key={value} type="button" aria-pressed={active === value} onClick={() => setActive(value)}>{label}</button>)}
    </div>
    <div className="client-profile-body">
    <section className="client-appointment-history">
      <h4>Historique des rendez-vous</h4>
      {historyLoading && <p role="status">Chargement de l’historique…</p>}
      {historyError && <>
        <Feedback notice={{ kind: "error", text: historyError }} />
        <button className="admin-nav-link" type="button" onClick={onRetry}>Réessayer</button>
      </>}
      {!historyLoading && !historyError && <>
      {appointments.length === 0 && <p>Aucun rendez-vous dans cette fiche.</p>}
      <div className="appointment-list">
        {appointments.map((appointment) => <article className="appointment-card" key={appointment.id}>
          <header className="client-history-heading">
            <strong>{appointmentDate(appointment.starts_at)} · {appointment.service_name}</strong>
            <span className={`client-status-${appointment.status}`}>{appointment.status === "cancelled" ? "Annulé" : appointment.status === "no_show" ? "Non présenté" : "Confirmé"}</span>
          </header>
          <p>{priceLabel(appointment.price_dzd)}</p>
          {appointment.private_note && <p className="client-appointment-note"><strong>Note privée du rendez-vous :</strong> {appointment.private_note}</p>}
          {appointment.sale_total_dzd !== null && <p className="field-hint">{appointment.voided_at ? "Vente annulée" : `Vente liée : ${priceLabel(appointment.sale_total_dzd)}${appointment.payment_method ? ` · ${paymentNames[appointment.payment_method] || appointment.payment_method}` : ""}`}</p>}
        </article>)}
      </div>
      <nav className="pagination" aria-label="Pages de l’historique client">
        {historyPage > 1 && <button className="admin-nav-link" type="button" onClick={() => onHistoryPage(historyPage - 1)}>Rendez-vous plus récents</button>}
        {hasMoreHistory && <button className="admin-nav-link" type="button" onClick={() => onHistoryPage(historyPage + 1)}>Rendez-vous plus anciens</button>}
      </nav>
      </>}
    </section>
    <form className="client-private-note" onSubmit={saveNote}>
      <div className="client-note-heading"><label htmlFor={`client-note-${client.id}`}>Note permanente</label><span>Privée</span></div>
      <p className="field-hint">Visible uniquement par les professionnels de votre établissement. La note n’est pas visible par le client ni par les autres salons.</p>
      <textarea id={`client-note-${client.id}`} rows={4} maxLength={4000} value={note} disabled={saving} onChange={(event) => setDraft(event.target.value)} />
      <div className="client-note-footer">
        <span>{noteBytes} / 4 000 octets{updatedAt && ` · Modifiée le ${appointmentDate(updatedAt)}`}</span>
        <button className="admin-nav-link" type="submit" disabled={saving || noteBytes > 4000}>{saving ? "Enregistrement…" : "Enregistrer la note"}</button>
      </div>
      <Feedback notice={notice} />
    </form>
    </div>
    <details className="client-profile-info" open={active === "info" || undefined}>
      <summary>Autres informations et statistiques</summary>
      <div className="client-profile-grid">
        <article><span>Date de naissance</span><strong>{client.date_of_birth.split("-").reverse().join("/")}</strong></article>
        <article><span>Rendez-vous</span><strong>{client.appointment_count} au total · {client.confirmed_count} confirmé(s) · {client.cancelled_count} annulé(s){client.no_show_count > 0 && ` · ${client.no_show_count} non présenté(s)`}</strong></article>
      </div>
      <h4>Dépenses liées aux rendez-vous</h4>
      <p className="field-hint">Toutes les ventes non annulées rattachées à un rendez-vous de ce client dans le salon. Les achats sans rendez-vous ne sont pas attribués.</p>
      <div className="client-profile-grid">
        <article><span>Total des ventes</span><strong>{priceLabel(client.total_spent_dzd)}</strong></article>
        <article><span>Encaissé hors cartes cadeaux</span><strong>{priceLabel(client.total_collected_dzd)}</strong></article>
        <article><span>Cartes cadeaux utilisées</span><strong>{priceLabel(client.total_gift_card_dzd)}</strong></article>
      </div>
      <h4>Fréquence des visites</h4>
      <p className="field-hint">Seuls les rendez-vous terminés avec une vente non annulée comptent. Plusieurs rendez-vous le même jour comptent comme un seul jour de visite.</p>
      <div className="client-profile-grid">
        <article><span>Jours de visite</span><strong>{client.paid_visit_days}</strong></article>
        <article><span>Dernière visite avec vente</span><strong>{client.last_paid_visit ? appointmentDate(client.last_paid_visit) : "Aucune"}</strong></article>
        <article><span>Intervalle moyen</span><strong>{client.average_visit_interval_days == null ? "Au moins deux jours de visite nécessaires" : `${client.average_visit_interval_days.toLocaleString("fr-FR")} j`}</strong></article>
      </div>
    </details>
  </section>;
}
