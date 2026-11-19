import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, apiUrl, algerianDate, appointmentDate, priceLabel, weekDays } from "./api-client.js";
import { getWilayaName } from "./data/algerian-wilayas.js";

export function DirectoryResults({ search }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const params = new URLSearchParams(search);
  const currentPage = Number(params.get("page") || 1);
  const pageLink = (page) => {
    const next = new URLSearchParams(search);
    next.set("page", String(page));
    return `/recherche?${next}`;
  };
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    apiRequest(`salons.php${search}`, { signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [search]);
  return (
    <>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {!result && !error && <p role="status">Recherche des établissements…</p>}
      {result?.salons.length === 0 && (
        <div className="empty-results">
          <h2>Aucun établissement pour cette recherche</h2>
          <p>Essayez une autre prestation, une ville ou une autre wilaya.</p>
        </div>
      )}
      <div className="salon-grid">
        {result?.salons.map((salon) => (
          <article className="client-card" key={salon.id}>
            <div className="salon-presentation-image">
              {salon.presentation_photo_id && <img
                src={apiUrl(`salon-photo.php?id=${encodeURIComponent(salon.presentation_photo_id)}`)}
                alt={`Présentation de ${salon.name}`}
                loading="lazy"
              />}
            </div>
            <p className="eyebrow">{getWilayaName(salon.wilaya_code)}</p>
            <h2>{salon.name}</h2>
            <p>{salon.address}, {salon.city}</p>
            <p>À partir de {priceLabel(salon.from_price)}</p>
            <Link className="back-link" to={`/salons/${salon.id}`}>Voir les prestations</Link>
          </article>
        ))}
      </div>
      {result && <nav className="pagination" aria-label="Pages des établissements">
        {currentPage > 1 && <Link className="admin-nav-link" to={pageLink(currentPage - 1)}>Précédent</Link>}
        {result.hasMore && <Link className="admin-nav-link" to={pageLink(currentPage + 1)}>Suivant</Link>}
      </nav>}
    </>
  );
}

export function SalonPage() {
  const { salonId } = useParams();
  const [params] = useSearchParams();
  const appointmentId = params.get("appointmentId");
  const [result, setResult] = useState(null);
  const [session, setSession] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    Promise.all([
      apiRequest(`salons.php?id=${encodeURIComponent(salonId)}`, { signal: controller.signal }),
      apiRequest("session.php", { signal: controller.signal }),
    ]).then(([salon, user]) => { setResult(salon); setSession(user); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [salonId]);
  return (
    <main className="client-page">
      <header className="commercial-header">
        <Link className="logo" to="/">BOOKILI</Link>
        <Link className="admin-nav-link" to="/espace-client">Mon compte</Link>
      </header>
      <div className="client-content booking-content">
        <Link className="results-back" to="/recherche">← Retour à l’annuaire</Link>
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {!result && !error && <p>Chargement de l’établissement…</p>}
        {result && (
          <>
            <p className="eyebrow">{getWilayaName(result.salon.wilaya_code)} · {result.salon.city}</p>
            <h1>{result.salon.name}</h1>
            <p>{result.salon.address}</p>
            <a href={`tel:${result.salon.phone_number}`}>{result.salon.phone_number}</a>
            {result.photos.length > 0 && <div className="public-salon-gallery" aria-label="Photos de l’établissement">
              {result.photos.map((photo, index) => <img
                key={photo.id}
                src={apiUrl(`salon-photo.php?id=${encodeURIComponent(photo.id)}`)}
                alt={`${result.salon.name} — photo ${index + 1}`}
              />)}
            </div>}
            <section className="client-card">
              <h2>{appointmentId ? "Modifier mon rendez-vous" : "Prendre rendez-vous"}</h2>
              <p>Horaires d’Algérie · Réservation jusqu’à 60 jours à l’avance.</p>
              <BookingForm key={`${salonId}-${appointmentId || "new"}`} salonId={salonId} services={result.services} session={session} appointmentId={appointmentId} bookingMessage={result.salon.booking_message} />
            </section>
            <section className="client-card">
              <h2>Horaires d’ouverture</h2>
              <dl className="client-details">
                {weekDays.map((name, index) => {
                  const hours = result.hours.find((hour) => Number(hour.weekday) === index + 1);
                  return <div key={name}><dt>{name}</dt><dd>{hours ? `${hours.opens_at.slice(0, 5)} – ${hours.closes_at.slice(0, 5)}` : "Fermé"}</dd></div>;
                })}
              </dl>
            </section>
            {(result.salon.public_description || result.profileEntries.length > 0) && <section className="client-card">
              <h2>À propos de l’établissement</h2>
              {result.salon.public_description && <p className="booking-message">{result.salon.public_description}</p>}
              {categories.map(([category, label]) => {
                const entries = result.profileEntries.filter((entry) => entry.category === category);
                return entries.length > 0 && <div key={category}>
                  <h3>{label}</h3>
                  {entries.map((entry) => <p key={entry.id}><strong>{entry.title}</strong>{entry.details && <><br />{entry.details}</>}</p>)}
                </div>;
              })}
            </section>}
          </>
        )}
      </div>
    </main>
  );
}

const categories = [["access", "Accès"], ["training", "Formations"], ["experience", "Expériences"]];

function BookingForm({ salonId, services, session, appointmentId, bookingMessage }) {
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [staffMembers, setStaffMembers] = useState([]);
  const [date, setDate] = useState(algerianDate());
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [slotError, setSlotError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const selected = services.find((service) => String(service.id) === serviceId);
  const client = session?.authenticated && session.account?.role === "client";

  useEffect(() => {
    const controller = new AbortController();
    setTime("");
    setSlots([]);
    setSlotError("");
    if (!serviceId || !date) {
      setLoading(false);
      setStaffMembers([]);
      setStaffId("");
      return;
    }
    setLoading(true);
    const query = new URLSearchParams({ salonId, serviceId, date });
    if (staffId) query.set("staffId", staffId);
    if (appointmentId) query.set("appointmentId", appointmentId);
    apiRequest(`availability.php?${query}`, { signal: controller.signal })
      .then((result) => {
        const activeStaff = result.staff || [];
        setStaffMembers(activeStaff);
        if (staffId && !activeStaff.some((member) => String(member.id) === staffId && !member.is_absent)) setStaffId("");
        setSlots(result.slots);
      })
      .catch((cause) => { if (!controller.signal.aborted) setSlotError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [salonId, serviceId, date, staffId, appointmentId, refresh]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("appointments.php", {
        csrfToken: session.csrfToken,
        body: {
          action: appointmentId ? "reschedule" : "book", salonId, serviceId, date, time,
          expectedPrice: Number(selected.price_dzd), expectedDuration: Number(selected.duration_minutes),
          ...(staffId ? { staffId: Number(staffId) } : {}),
          ...(appointmentId ? { appointmentId } : {}),
        },
      });
      setConfirmed(true);
      setNotice({ kind: "success", text: result.message });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
      setRefresh((value) => value + 1);
    } finally {
      setSaving(false);
    }
  }
  if (confirmed) {
    return <><p className="form-message form-success" role="status">{notice.text} Un e-mail de confirmation sera envoyé selon la fréquence du cron. Les rappels sont programmés à J−7 et J−1 lorsque la date le permet.</p><Link className="back-link" to="/espace-client">Voir mes rendez-vous</Link></>;
  }
  return (
    <>
      {notice && <p className={`form-message form-${notice.kind}`} role="alert">{notice.text}</p>}
      {appointmentId && <p className="field-hint">Choisissez une prestation et un nouveau créneau. Votre réservation actuelle est conservée si la modification échoue.</p>}
      <form className="auth-form" onSubmit={submit}>
        <label>Prestation
          <select required value={serviceId} onChange={(event) => setServiceId(event.target.value)} disabled={saving}>
            <option value="">Choisir une prestation</option>
            {services.map((service) => <option key={service.id} value={service.id}>{service.name} · {service.duration_minutes} min · {priceLabel(service.price_dzd)}</option>)}
          </select>
        </label>
        <label>Date
          <input required type="date" min={algerianDate()} max={algerianDate(60)} value={date} onChange={(event) => setDate(event.target.value)} disabled={saving} />
        </label>
        {staffMembers.length > 0 && <label>Collaborateur
          <select required value={staffId} onChange={(event) => setStaffId(event.target.value)} disabled={saving}>
            <option value="">Choisir un collaborateur</option>
            {staffMembers.map((member) => <option key={member.id} value={member.id} disabled={member.is_absent}>{member.name}{member.is_absent ? " — Absent" : ""}</option>)}
          </select>
        </label>}
        {!staffId && staffMembers.length > 0 && <p className="field-hint">Les créneaux seront affichés après le choix du collaborateur.</p>}
        {loading && <p role="status">Recherche des créneaux…</p>}
        {slotError && <p className="form-message form-error" role="alert">{slotError}</p>}
        {!loading && serviceId && !slotError && slots.length === 0 && <p>Aucun créneau disponible ce jour. Choisissez une autre date.</p>}
        {slots.length > 0 && <label>Horaire
          <select required value={time} onChange={(event) => setTime(event.target.value)} disabled={saving || loading}>
            <option value="">Choisir un horaire</option>
            {slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
          </select>
        </label>}
        {selected && <p>{selected.name} · {selected.duration_minutes} minutes · <strong>{priceLabel(selected.price_dzd)}</strong><br />Paiement sur place. Aucun paiement en ligne.</p>}
        {time && bookingMessage && <p className="field-hint booking-message"><strong>Message de l’établissement</strong><br />{bookingMessage}</p>}
        {client ? <button className="auth-submit" disabled={!time || loading || saving || !!slotError} type="submit">{saving ? "Enregistrement…" : appointmentId ? "Confirmer la modification" : "Confirmer le rendez-vous"}</button> : (
          <p className="form-message">Connectez-vous avec un compte client pour réserver. <Link className="inline-link" to={`/compte?retour=${encodeURIComponent(`/salons/${salonId}${appointmentId ? `?appointmentId=${appointmentId}` : ""}`)}`}>Connexion ou inscription</Link></p>
        )}
      </form>
    </>
  );
}

export function Appointments({ csrfToken, professional = false }) {
  const [filter, setFilter] = useState("upcoming");
  const [date, setDate] = useState(algerianDate());
  const [page, setPage] = useState(1);
  const [staffId, setStaffId] = useState("");
  const [staffMembers, setStaffMembers] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!professional) return undefined;
    const controller = new AbortController();
    apiRequest("professional-staff.php", { signal: controller.signal })
      .then((response) => setStaffMembers(response.staff))
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [professional]);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    const query = new URLSearchParams(professional ? { date, page } : { filter, page });
    if (professional && staffId) query.set("staffId", staffId);
    apiRequest(`appointments.php?${query}`, { signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [professional, date, filter, page, staffId, refresh]);

  async function cancel(id) {
    if (!window.confirm("Confirmer l’annulation de ce rendez-vous ?")) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await apiRequest("appointments.php", { csrfToken, body: { action: "cancel", appointmentId: id } });
      setNotice(response.message);
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause.message); }
    finally { setWorking(false); }
  }
  return (
    <section className="client-card">
      <h2>{professional ? "Agenda" : "Mes rendez-vous"}</h2>
      <p className="field-hint">Horaires d’Algérie (UTC+1). Confirmation et rappels envoyés par e-mail par la tâche cron du site.</p>
      <div className="booking-toolbar">
        {professional ? <><label>Journée <input aria-label="Journée de l’agenda" type="date" required value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} /></label>
          {staffMembers.length > 0 && <label>Collaborateur<select aria-label="Filtrer par collaborateur" value={staffId} onChange={(event) => { setStaffId(event.target.value); setPage(1); }}>
            <option value="">Toute l’équipe</option>{staffMembers.map((member) => <option key={member.id} value={member.id}>{member.name}{Number(member.is_active) ? "" : " (inactif)"}</option>)}
          </select></label>}
        </> : (
          <label>Afficher <select aria-label="Filtre des rendez-vous" value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
            <option value="upcoming">À venir</option><option value="past">Passés</option>
          </select></label>
        )}
        <button className="admin-nav-link" type="button" disabled={working} onClick={() => setRefresh((value) => value + 1)}>Actualiser</button>
      </div>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="form-message form-success" role="status">{notice}</p>}
      {!result && !error && <p>Chargement des rendez-vous…</p>}
      {result?.appointments.length === 0 && <p>Aucun rendez-vous dans cette sélection.</p>}
      <div className="appointment-list">
        {result?.appointments.map((appointment) => {
          const editable = appointment.status === "confirmed" && new Date(appointment.starts_at.replace(" ", "T") + "+01:00") > new Date();
          return (
            <article className="appointment-card" key={appointment.id}>
              <p className={`application-status ${appointment.status === "cancelled" ? "status-rejected" : "status-approved"}`}>{appointment.status === "cancelled" ? "Annulé" : "Confirmé"}</p>
              <h3>{appointment.service_name}</h3>
              <p>{appointmentDate(appointment.starts_at)} · {priceLabel(appointment.price_dzd)}{appointment.staff_name && <> · {appointment.staff_name}</>}</p>
              {professional ? <p>{appointment.first_name} {appointment.last_name} · <a className="inline-link" href={`tel:${appointment.client_phone}`}>{appointment.client_phone}</a></p> : (
                <p>{appointment.salon_name} · {appointment.address}, {appointment.city}<br /><a className="inline-link" href={`tel:${appointment.salon_phone}`}>{appointment.salon_phone}</a></p>
              )}
              {editable && <div className="review-buttons">
                {!professional && <Link className="admin-nav-link" to={`/salons/${appointment.salon_id}?appointmentId=${appointment.id}`}>Modifier</Link>}
                <button className="review-reject" type="button" disabled={working} onClick={() => cancel(appointment.id)}>Annuler</button>
              </div>}
            </article>
          );
        })}
      </div>
      {result && <nav className="pagination" aria-label="Pages des rendez-vous">
        {page > 1 && <button className="admin-nav-link" onClick={() => setPage(page - 1)} type="button">Précédent</button>}
        {result.hasMore && <button className="admin-nav-link" onClick={() => setPage(page + 1)} type="button">Suivant</button>}
      </nav>}
    </section>
  );
}
