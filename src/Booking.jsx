import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, apiUrl, algerianDate, appointmentDate, priceLabel, weekDays } from "./api-client.js";
import { createBookingCalendarEvent } from "./lib/booking-calendar.js";
import { getWilayaName } from "./data/algerian-wilayas.js";

export function DirectoryResults({ search }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const params = new URLSearchParams(search);
  const currentPage = Number(params.get("page") || 1);
  const city = params.get("ville")?.trim();
  const wilaya = getWilayaName(params.get("wilaya"));
  const broaderSearch = new URLSearchParams(params);
  broaderSearch.delete("page");
  broaderSearch.delete("ville");
  if (!city) broaderSearch.delete("wilaya");
  const broaderLink = `/recherche${broaderSearch.size ? `?${broaderSearch}` : ""}`;
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
          <p>{city || wilaya
            ? "Élargissez la zone ou modifiez vos filtres."
            : "Essayez une autre prestation ou une autre catégorie."}</p>
          {(city || wilaya) && <Link className="admin-nav-link" to={broaderLink}>
            {city && wilaya ? `Rechercher dans toute la wilaya de ${wilaya}` : "Rechercher dans toute l’Algérie"}
          </Link>}
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
  const requestedDate = params.get("date") || "";
  const parsedRequestedDate = new Date(`${requestedDate}T00:00:00Z`);
  const validRequestedDate = !Number.isNaN(parsedRequestedDate.valueOf())
    && parsedRequestedDate.toISOString().slice(0, 10) === requestedDate;
  const requestedServices = params.has("serviceIds")
    ? params.get("serviceIds").split(",")
    : params.has("serviceId") ? [params.get("serviceId")] : [];
  const validRequestedServices = requestedServices.length <= 6
    && new Set(requestedServices).size === requestedServices.length
    && requestedServices.every((id) => /^[1-9][0-9]*$/.test(id));
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
              <BookingForm
                key={`${salonId}-${appointmentId || "new"}`}
                salonId={salonId}
                services={result.services}
                session={session}
                appointmentId={appointmentId}
                salonName={result.salon.name}
                salonAddress={`${result.salon.address}, ${result.salon.city}`}
                bookingMessage={result.salon.booking_message}
                initialSelection={{
                  serviceIds: validRequestedServices && requestedServices.every((id) => result.services.some((service) => String(service.id) === id)) ? requestedServices : [],
                  serviceUnavailable: requestedServices.length > 0 && (!validRequestedServices || !requestedServices.every((id) => result.services.some((service) => String(service.id) === id))),
                  unknownServices: appointmentId && (params.get("unknownServices") === "1" || params.get("multipleServices") === "1"),
                  staffId: /^[1-9][0-9]*$/.test(params.get("staffId") || "") ? params.get("staffId") : "",
                  date: validRequestedDate && requestedDate >= algerianDate() && requestedDate <= algerianDate(60)
                    ? requestedDate
                    : algerianDate(),
                  time: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.get("time") || "") ? params.get("time") : "",
                }}
              />
            </section>
            <section className="client-card">
              <h2>Horaires d’ouverture</h2>
              <dl className="client-details">
                {weekDays.map((name, index) => {
                  const hours = result.hours.find((hour) => Number(hour.weekday) === index + 1);
                  const pause = hours?.pause_starts_at && hours?.pause_ends_at;
                  return <div key={name}><dt>{name}</dt><dd>{hours
                    ? pause
                      ? `${hours.opens_at.slice(0, 5)} – ${hours.pause_starts_at.slice(0, 5)} · Pause ${hours.pause_starts_at.slice(0, 5)} – ${hours.pause_ends_at.slice(0, 5)} · ${hours.pause_ends_at.slice(0, 5)} – ${hours.closes_at.slice(0, 5)}`
                      : `${hours.opens_at.slice(0, 5)} – ${hours.closes_at.slice(0, 5)}`
                    : "Fermé"}</dd></div>;
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

function CalendarDownloadButton({ details }) {
  const [error, setError] = useState("");

  function download() {
    setError("");
    try {
      const calendar = createBookingCalendarEvent(details);
      const url = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `BOOKILI-rendez-vous-${details.date}.ics`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError("Impossible de préparer le fichier calendrier. Réessayez ou consultez votre e-mail de confirmation.");
    }
  }

  return <>
    <button className="admin-nav-link" type="button" onClick={download}>Ajouter au calendrier (.ics)</button>
    {error && <p className="form-message form-error" role="alert">{error}</p>}
  </>;
}

function BookingForm({ salonId, salonName, salonAddress, services, session, appointmentId, bookingMessage, initialSelection }) {
  const [serviceIds, setServiceIds] = useState(initialSelection.serviceIds);
  const [staffId, setStaffId] = useState(initialSelection.staffId);
  const [staffMembers, setStaffMembers] = useState([]);
  const [date, setDate] = useState(initialSelection.date);
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [slotError, setSlotError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [timeRestoreNotice, setTimeRestoreNotice] = useState("");
  const [confirmedAppointmentId, setConfirmedAppointmentId] = useState(null);
  const timeToRestore = useRef(initialSelection.time);
  const selectedServices = serviceIds.map((id) => services.find((service) => String(service.id) === id)).filter(Boolean);
  const selected = selectedServices.length > 0 && selectedServices.length === serviceIds.length ? {
    name: selectedServices.map((service) => service.name).join(" + "),
    duration_minutes: selectedServices.reduce((total, service) => total + Number(service.duration_minutes), 0),
    price_dzd: selectedServices.reduce((total, service) => total + Number(service.price_dzd), 0),
  } : null;
  const serviceKey = serviceIds.join(",");
  const selectedStaff = staffMembers.find((member) => String(member.id) === staffId);
  const client = session?.authenticated && session.account?.role === "client";
  const returnParams = new URLSearchParams();
  if (appointmentId) returnParams.set("appointmentId", appointmentId);
  if (initialSelection.unknownServices) returnParams.set("unknownServices", "1");
  if (serviceKey) returnParams.set(appointmentId || serviceIds.length > 1 ? "serviceIds" : "serviceId", serviceKey);
  if (date) returnParams.set("date", date);
  if (time) returnParams.set("time", time);
  if (staffId) returnParams.set("staffId", staffId);
  const returnTo = `/salons/${salonId}?${returnParams}`;

  useEffect(() => {
    const controller = new AbortController();
    setTime("");
    setSlots([]);
    setSlotError("");
    if (!serviceKey || !date) {
      setLoading(false);
      setStaffMembers([]);
      return;
    }
    setLoading(true);
    const query = new URLSearchParams({ salonId, date });
    query.set(appointmentId || serviceIds.length > 1 ? "serviceIds" : "serviceId", serviceKey);
    if (staffId) query.set("staffId", staffId);
    if (appointmentId) query.set("appointmentId", appointmentId);
    apiRequest(`availability.php?${query}`, { signal: controller.signal })
      .then((result) => {
        const activeStaff = result.staff || [];
        setStaffMembers(activeStaff);
        if (staffId && !activeStaff.some((member) => String(member.id) === staffId && !member.is_absent)) {
          setStaffId("");
          setTimeRestoreNotice("Ce collaborateur n’est plus disponible pour cette date. Vérifiez le collaborateur et choisissez un créneau.");
          timeToRestore.current = "";
          return;
        }
        setSlots(result.slots);
        const requestedTime = timeToRestore.current;
        timeToRestore.current = "";
        if (requestedTime) {
          if (result.slots.includes(requestedTime)) setTime(requestedTime);
          else setTimeRestoreNotice("Le créneau choisi n’est plus disponible. Sélectionnez un autre horaire.");
        }
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        if (staffId && cause.message === "Ce collaborateur n’est plus disponible.") {
          setStaffId("");
          timeToRestore.current = "";
          setTimeRestoreNotice("Ce collaborateur n’est plus disponible. Vérifiez le collaborateur et choisissez un créneau.");
        } else setSlotError(cause.message);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [salonId, serviceKey, date, staffId, appointmentId, refresh]);

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("appointments.php", {
        csrfToken: session.csrfToken,
        body: {
          action: appointmentId ? "reschedule" : "book", salonId, date, time,
          ...(appointmentId || serviceIds.length > 1 ? { serviceIds: serviceIds.map(Number) } : { serviceId: serviceIds[0] }),
          expectedPrice: Number(selected.price_dzd), expectedDuration: Number(selected.duration_minutes),
          ...(staffId ? { staffId: Number(staffId) } : {}),
          ...(appointmentId ? { appointmentId } : {}),
        },
      });
      setConfirmedAppointmentId(result.appointmentId);
      setConfirmed(true);
      setNotice({ kind: "success", text: appointmentId ? "Votre rendez-vous a bien été modifié." : result.message });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
      setRefresh((value) => value + 1);
    } finally {
      setSaving(false);
    }
  }
  if (confirmed) {
    return <>
      <div className="booking-confirmation">
        <p className="form-message form-success" role="status">{notice.text}</p>
        <h3>Récapitulatif du rendez-vous</h3>
        <dl className="client-details">
          <div><dt>Établissement</dt><dd>{salonName}</dd></div>
          <div><dt>Prestation</dt><dd>{selected.name}</dd></div>
          <div><dt>Date et heure</dt><dd>{appointmentDate(`${date} ${time}:00`)}</dd></div>
          <div><dt>Collaborateur</dt><dd>{selectedStaff?.name || "Non attribué"}</dd></div>
          <div><dt>Durée</dt><dd>{selected.duration_minutes} min</dd></div>
          <div><dt>Tarif</dt><dd>{priceLabel(selected.price_dzd)} · paiement sur place</dd></div>
        </dl>
        <p className="field-hint">
          Un e-mail de {appointmentId ? "modification" : "confirmation"} sera envoyé selon la fréquence du cron.
          Les rappels sont programmés à J−7 et J−1 lorsque la date le permet.
        </p>
        {appointmentId && <p className="field-hint">Si vous avez ajouté l’ancien rendez-vous à votre calendrier, mettez-le à jour manuellement : il n’est pas synchronisé automatiquement.</p>}
      </div>
      {confirmedAppointmentId && <CalendarDownloadButton details={{
        appointmentId: confirmedAppointmentId, salonId, salonName, salonAddress,
        serviceName: selected.name, date, time, durationMinutes: Number(selected.duration_minutes),
        staffName: selectedStaff?.name || "Non attribué", priceLabel: priceLabel(selected.price_dzd),
      }} />}
      <Link className="back-link" to="/espace-client">Voir mes rendez-vous</Link>
    </>;
  }
  return (
    <>
      {notice && <p className={`form-message form-${notice.kind}`} role="alert">{notice.text}</p>}
      {appointmentId && <p className="field-hint">Choisissez jusqu’à six prestations et un nouveau créneau. Les tarifs et durées affichés sont ceux actuellement proposés. Votre réservation actuelle reste inchangée tant que la modification n’est pas confirmée ou si elle échoue.</p>}
      {initialSelection.unknownServices && <p className="form-message" role="status">Vérifiez les prestations de votre rendez-vous et sélectionnez celles que vous souhaitez conserver.</p>}
      {initialSelection.serviceUnavailable && <p className="form-message" role="status">{appointmentId
        ? "Certaines prestations initiales ne sont plus disponibles ou sont invalides. Sélectionnez les prestations que vous souhaitez conserver."
        : "Certaines prestations choisies ne sont plus disponibles ou sont invalides. Sélectionnez à nouveau vos prestations."}</p>}
      <form className="auth-form" onSubmit={submit}>
        <fieldset className="agenda-service-picker booking-service-picker" disabled={saving}>
          <legend>Prestations · 6 maximum</legend>
          {services.map((service) => <label className="checkbox-label" key={service.id}>
            <input type="checkbox" name="bookingService" value={service.id} checked={serviceIds.includes(String(service.id))}
              disabled={!serviceIds.includes(String(service.id)) && serviceIds.length >= 6}
              onChange={(event) => {
                const checked = event.target.checked;
                timeToRestore.current = "";
                setServiceIds((ids) => checked ? [...ids, String(service.id)] : ids.filter((id) => id !== String(service.id)));
                setTime("");
                setTimeRestoreNotice("");
              }} />
            {service.name} · {service.duration_minutes} min · {priceLabel(service.price_dzd)}
          </label>)}
        </fieldset>
        <label>Date
          <input required type="date" min={algerianDate()} max={algerianDate(60)} value={date} onChange={(event) => { timeToRestore.current = ""; setDate(event.target.value); setTime(""); setTimeRestoreNotice(""); }} disabled={saving} />
        </label>
        {staffMembers.length > 0 && <label>Collaborateur
          <select required value={staffId} onChange={(event) => { timeToRestore.current = ""; setStaffId(event.target.value); setTime(""); setTimeRestoreNotice(""); }} disabled={saving}>
            <option value="">Choisir un collaborateur</option>
            {staffMembers.map((member) => <option key={member.id} value={member.id} disabled={member.is_absent}>{member.name}{member.is_absent ? " — Absent" : ""}</option>)}
          </select>
        </label>}
        {!staffId && staffMembers.length > 0 && <p className="field-hint">Les créneaux seront affichés après le choix du collaborateur.</p>}
        {loading && <p role="status">Recherche des créneaux…</p>}
        {slotError && <p className="form-message form-error" role="alert">{slotError}</p>}
        {timeRestoreNotice && <p className="field-hint" role="status">{timeRestoreNotice}</p>}
        {!loading && serviceKey && !slotError && slots.length === 0 && <p>Aucun créneau disponible ce jour. Choisissez une autre date.</p>}
        {slots.length > 0 && <fieldset className="booking-time-picker" disabled={saving || loading}>
          <legend>Horaire · {slots.length} créneaux disponibles</legend>
          <div className="booking-time-options">
            {slots.map((slot, index) => <label className={`booking-time-option${time === slot ? " booking-time-selected" : ""}`} key={slot}>
              <input
                type="radio"
                name="bookingTime"
                value={slot}
                checked={time === slot}
                required={index === 0}
                onChange={() => { setTime(slot); setTimeRestoreNotice(""); }}
              />
              <span>{slot}</span>
            </label>)}
          </div>
        </fieldset>}
        {selected && <p>{selected.name} · {selected.duration_minutes} minutes · <strong>{priceLabel(selected.price_dzd)}</strong><br />Paiement sur place. Aucun paiement en ligne.</p>}
        {time && bookingMessage && <p className="field-hint booking-message"><strong>Message de l’établissement</strong><br />{bookingMessage}</p>}
        {client ? <button className="auth-submit" disabled={!selected || !time || loading || saving || !!slotError} type="submit">{saving ? "Enregistrement…" : appointmentId ? "Confirmer la modification" : "Confirmer le rendez-vous"}</button> : (
          <p className="form-message">Connectez-vous avec un compte client pour réserver. <Link className="inline-link" to={`/compte?retour=${encodeURIComponent(returnTo)}`}>Connexion ou inscription</Link></p>
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

  async function cancel(appointment) {
    const confirmation = professional
      ? "Confirmer l’annulation de ce rendez-vous ?"
      : `Annuler ce rendez-vous ?\n\n${appointment.service_name} · ${appointment.salon_name}\n${appointmentDate(appointment.starts_at)} (heure d’Algérie)\n\nSi vous l’avez ajouté à votre calendrier, vous devrez le supprimer manuellement.`;
    if (!window.confirm(confirmation)) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await apiRequest("appointments.php", { csrfToken, body: { action: "cancel", appointmentId: appointment.id } });
      setNotice(professional ? response.message : `${response.message} Un e-mail d’annulation est en attente d’envoi. Si vous avez ajouté ce rendez-vous à votre calendrier, supprimez-le manuellement.`);
      setRefresh((value) => value + 1);
    } catch (cause) { setError(cause.message); }
    finally { setWorking(false); }
  }
  function modificationLink(appointment) {
    const params = new URLSearchParams({
      appointmentId: appointment.id,
      date: appointment.starts_at.slice(0, 10),
    });
    const count = Number(appointment.service_count);
    const ids = Array.isArray(appointment.services) ? appointment.services.map((service) => String(service.id)) : [];
    if (count >= 1 && count <= 6 && ids.length === count && ids[0] === String(appointment.service_id)
        && new Set(ids).size === ids.length && ids.every((id) => /^[1-9][0-9]*$/.test(id))) {
      params.set(count === 1 ? "serviceId" : "serviceIds", ids.join(","));
    } else params.set("unknownServices", "1");
    if (appointment.staff_id) params.set("staffId", appointment.staff_id);
    return `/salons/${appointment.salon_id}?${params}`;
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
                {!professional && <Link className="admin-nav-link" to={modificationLink(appointment)}>Modifier</Link>}
                {!professional && <CalendarDownloadButton details={{
                  appointmentId: appointment.id, salonId: appointment.salon_id, salonName: appointment.salon_name,
                  salonAddress: `${appointment.address}, ${appointment.city}`, serviceName: appointment.service_name,
                  date: appointment.starts_at.slice(0, 10), time: appointment.starts_at.slice(11, 16),
                  durationMinutes: (new Date(appointment.ends_at.replace(" ", "T") + "+01:00") - new Date(appointment.starts_at.replace(" ", "T") + "+01:00")) / 60000,
                  staffName: appointment.staff_name || "Non attribué", priceLabel: priceLabel(appointment.price_dzd),
                }} />}
                <button className="review-reject" type="button" disabled={working} onClick={() => cancel(appointment)}>Annuler</button>
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
