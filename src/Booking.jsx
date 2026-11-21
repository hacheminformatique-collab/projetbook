import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router-dom";
import { apiRequest, apiUrl, algerianDate, appointmentDate, priceLabel, weekDays } from "./api-client.js";
import { createBookingCalendarEvent } from "./lib/booking-calendar.js";
import { validAppointmentPrice, validAppointmentServiceDetails, validAppointmentVersion, validServiceDetails } from "./lib/appointment-services.js";
import { getWilayaName } from "./data/algerian-wilayas.js";

export function DirectoryResults({ search, requestKey }) {
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
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [search, requestKey]);
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
  const { state } = useLocation();
  const [params] = useSearchParams();
  const appointmentId = params.get("appointmentId");
  const requestedDate = params.get("date") || "";
  const parsedRequestedDate = new Date(`${requestedDate}T00:00:00Z`);
  const validRequestedDate = !Number.isNaN(parsedRequestedDate.valueOf())
    && parsedRequestedDate.toISOString().slice(0, 10) === requestedDate;
  const dateInRange = validRequestedDate && requestedDate >= algerianDate() && requestedDate <= algerianDate(60);
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
              <BookingForm
                key={`${salonId}-${appointmentId || "new"}`}
                salonId={salonId}
                services={result.services}
                session={session}
                appointmentId={appointmentId}
                resumedBooking={state?.resumedBooking === true && !appointmentId}
                salonName={result.salon.name}
                salonAddress={`${result.salon.address}, ${result.salon.city}`}
                bookingMessage={result.salon.booking_message}
                initialSelection={{
                  serviceIds: validRequestedServices && requestedServices.every((id) => result.services.some((service) => String(service.id) === id)) ? requestedServices : [],
                  serviceUnavailable: requestedServices.length > 0 && (!validRequestedServices || !requestedServices.every((id) => result.services.some((service) => String(service.id) === id))),
                  unknownServices: appointmentId && (params.get("unknownServices") === "1" || params.get("multipleServices") === "1"),
                  appointmentVersion: validAppointmentVersion(params.get("version")) ? Number(params.get("version")) : null,
                  staffId: /^[1-9][0-9]*$/.test(params.get("staffId") || "") ? params.get("staffId") : "",
                  date: dateInRange ? requestedDate : algerianDate(),
                  dateUnavailable: !!requestedDate && !dateInRange,
                  time: (!requestedDate || dateInRange) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(params.get("time") || "") ? params.get("time") : "",
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

function ServiceBreakdown({ services }) {
  return <ul className="booking-service-breakdown" aria-label="Détail des prestations">
    {services.map((service) => <li key={service.id}>{service.name} · {service.duration_minutes} min · {priceLabel(service.price_dzd)}</li>)}
  </ul>;
}

function calendarServiceDetails(services) {
  return services.length > 1 ? [
    "Détail des prestations :",
    ...services.map((service) => `- ${service.name} : ${service.duration_minutes} min, ${priceLabel(service.price_dzd)}`),
  ] : [];
}

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

function BookingForm({ salonId, salonName, salonAddress, services, session, appointmentId, resumedBooking, bookingMessage, initialSelection }) {
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
  const [stale, setStale] = useState(false);
  const [timeRestoreNotice, setTimeRestoreNotice] = useState(initialSelection.dateUnavailable
    ? "La date choisie n’est plus disponible. Sélectionnez une autre date et un créneau." : "");
  const [restoredTime, setRestoredTime] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const [confirmedAppointmentId, setConfirmedAppointmentId] = useState(null);
  const [confirmedServices, setConfirmedServices] = useState(null);
  const timeToRestore = useRef(initialSelection.time);
  const bookingChoices = useRef(null);
  const selectedServices = serviceIds.map((id) => services.find((service) => String(service.id) === id)).filter(Boolean);
  const selected = selectedServices.length > 0 && selectedServices.length === serviceIds.length ? {
    name: selectedServices.map((service) => service.name).join(" + "),
    duration_minutes: selectedServices.reduce((total, service) => total + Number(service.duration_minutes), 0),
    price_dzd: selectedServices.reduce((total, service) => total + Number(service.price_dzd), 0),
  } : null;
  const serviceKey = serviceIds.join(",");
  const selectedStaff = staffMembers.find((member) => String(member.id) === staffId);
  const client = session?.authenticated && session.account?.role === "client";
  const canConfirm = client && selected && slots.includes(time) && (!staffMembers.length || selectedStaff)
    && !loading && !saving && !slotError && (!appointmentId || (initialSelection.appointmentVersion && !stale));
  const reviewing = resumedBooking && restoredTime && !reviewDismissed && client && selected && slots.includes(time)
    && (!staffMembers.length || selectedStaff) && !loading && !slotError;
  const returnParams = new URLSearchParams();
  if (appointmentId) returnParams.set("appointmentId", appointmentId);
  if (appointmentId && initialSelection.appointmentVersion) returnParams.set("version", String(initialSelection.appointmentVersion));
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
          if (result.slots.includes(requestedTime)) {
            setTime(requestedTime);
            setRestoredTime(true);
          }
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

  useEffect(() => {
    if (reviewDismissed) bookingChoices.current?.querySelector("input")?.focus();
  }, [reviewDismissed]);

  async function submit(event) {
    event.preventDefault();
    if (!canConfirm) return;
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
          ...(appointmentId ? { appointmentId, expectedVersion: initialSelection.appointmentVersion } : {}),
        },
      });
      setConfirmedAppointmentId(result.appointmentId);
      setConfirmedServices(validServiceDetails(result.services, serviceIds.length, selected.duration_minutes, selected.price_dzd)
        && result.services.every((service, index) => String(service.id) === serviceIds[index]) ? result.services : null);
      setConfirmed(true);
      setNotice({ kind: "success", text: appointmentId ? "Votre rendez-vous a bien été modifié." : result.message });
    } catch (cause) {
      if (reviewing) setReviewDismissed(true);
      setNotice({ kind: "error", text: cause.message });
      if (cause.code === "appointment_changed") setStale(true);
      setRefresh((value) => value + 1);
    } finally {
      setSaving(false);
    }
  }
  if (confirmed) {
    const confirmedName = confirmedServices?.map((service) => service.name).join(" + ");
    return <div className="booking-confirmation">
        <p className="form-message form-success" role="status">{notice.text}</p>
        <h3>Récapitulatif du rendez-vous</h3>
        {!confirmedServices && <p className="form-message form-error" role="alert">Le rendez-vous est confirmé, mais le détail des prestations est indisponible. Consultez vos rendez-vous dans l’espace client.</p>}
        <dl className="client-details">
          <div><dt>Établissement</dt><dd>{salonName}</dd></div>
          {confirmedServices && <div><dt>{confirmedServices.length > 1 ? "Prestations" : "Prestation"}</dt><dd>{confirmedServices.length > 1
            ? <ServiceBreakdown services={confirmedServices} /> : confirmedName}</dd></div>}
          <div><dt>Date et heure</dt><dd>{appointmentDate(`${date} ${time}:00`)}</dd></div>
          <div><dt>Collaborateur</dt><dd>{selectedStaff?.name || "Non attribué"}</dd></div>
          <div><dt>Durée</dt><dd>{selected.duration_minutes} min</dd></div>
          <div><dt>Tarif</dt><dd>{priceLabel(selected.price_dzd)} · paiement sur place</dd></div>
        </dl>
        <div className="booking-actions">
          <Link className="auth-submit booking-primary-link" to="/espace-client">Voir mes rendez-vous</Link>
          {confirmedAppointmentId && confirmedServices && <CalendarDownloadButton details={{
            appointmentId: confirmedAppointmentId, salonId, salonName, salonAddress,
            serviceName: confirmedName, date, time, durationMinutes: Number(selected.duration_minutes),
            staffName: selectedStaff?.name || "Non attribué", priceLabel: priceLabel(selected.price_dzd),
            serviceDetails: calendarServiceDetails(confirmedServices),
          }} />}
        </div>
        <p className="field-hint">Un e-mail de {appointmentId ? "modification" : "confirmation"} vous sera envoyé. Des rappels sont prévus 7 jours et 1 jour avant le rendez-vous, si la date le permet.</p>
        {appointmentId && <p className="field-hint">Si vous avez ajouté l’ancien rendez-vous à votre calendrier, mettez-le à jour manuellement : il n’est pas synchronisé automatiquement.</p>}
    </div>;
  }
  return (
    <>
      {notice && <p className={`form-message form-${notice.kind}`} role="alert">{notice.text}</p>}
      {appointmentId && (!initialSelection.appointmentVersion || stale) && <p className="form-message form-error" role="alert">
        Retournez à <Link className="inline-link" to="/espace-client">vos rendez-vous</Link> et ouvrez à nouveau le rendez-vous avant de le modifier.
      </p>}
      {appointmentId && <p className="field-hint">Choisissez jusqu’à six prestations et un nouveau créneau. Les tarifs et durées affichés sont ceux actuellement proposés. Votre réservation actuelle reste inchangée tant que la modification n’est pas confirmée ou si elle échoue.</p>}
      {initialSelection.unknownServices && <p className="form-message" role="status">Vérifiez les prestations de votre rendez-vous et sélectionnez celles que vous souhaitez conserver.</p>}
      {initialSelection.serviceUnavailable && <p className="form-message" role="status">{appointmentId
        ? "Certaines prestations initiales ne sont plus disponibles ou sont invalides. Sélectionnez les prestations que vous souhaitez conserver."
        : "Certaines prestations choisies ne sont plus disponibles ou sont invalides. Sélectionnez à nouveau vos prestations."}</p>}
      <form className="auth-form" onSubmit={submit}>
        <fieldset className="form-fieldset booking-choices" ref={bookingChoices} hidden={!!reviewing} disabled={!!reviewing}>
        <p className="field-hint">Horaires d’Algérie · Réservation jusqu’à 60 jours à l’avance.</p>
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
        </fieldset>
        {reviewing ? <section className="booking-summary booking-review" aria-labelledby="booking-review-title">
          <h3 id="booking-review-title">Vérifiez votre rendez-vous</h3>
          <p className="form-message form-success" role="status">Vos choix ont été retrouvés. Confirmez pour réserver.</p>
          <dl className="client-details">
            <div><dt>{serviceIds.length > 1 ? "Prestations" : "Prestation"}</dt><dd>{serviceIds.length > 1 ? <ServiceBreakdown services={selectedServices} /> : selected.name}</dd></div>
            <div><dt>Date et heure</dt><dd>{appointmentDate(`${date} ${time}:00`)}</dd></div>
            <div><dt>Collaborateur</dt><dd>{selectedStaff?.name || "Non attribué"}</dd></div>
            <div><dt>Durée</dt><dd>{selected.duration_minutes} min</dd></div>
            <div><dt>Total</dt><dd><strong>{priceLabel(selected.price_dzd)}</strong></dd></div>
          </dl>
          <p className="field-hint">Paiement sur place. Aucun paiement en ligne.</p>
        </section> : selected && <div className="booking-summary">
          <h3>Votre rendez-vous</h3>
          <p>{selected.name} · {selected.duration_minutes} minutes · <strong>{priceLabel(selected.price_dzd)}</strong></p>
          {time && <p className="field-hint">{appointmentDate(`${date} ${time}:00`)}{selectedStaff && ` · ${selectedStaff.name}`}</p>}
          <p className="field-hint">Paiement sur place. Aucun paiement en ligne.</p>
        </div>}
        {time && bookingMessage && <p className="field-hint booking-message"><strong>Message de l’établissement</strong><br />{bookingMessage}</p>}
        <div className="booking-actions">
          {client ? <button className="auth-submit" disabled={!canConfirm} type="submit">{saving ? "Enregistrement…" : appointmentId ? "Confirmer la modification" : "Confirmer le rendez-vous"}</button> : (
            <>
              <Link className="auth-submit inline-link booking-primary-link" to={`/compte?retour=${encodeURIComponent(returnTo)}`}>Connexion ou inscription pour continuer</Link>
              {time && <p className="field-hint">Vos choix seront conservés si le créneau est toujours disponible.</p>}
            </>
          )}
          {reviewing && <button className="admin-nav-link" type="button" disabled={saving} onClick={() => setReviewDismissed(true)}>Modifier mes choix</button>}
        </div>
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
  const [staleIds, setStaleIds] = useState([]);
  const [openId, setOpenId] = useState(null);
  const detailHeading = useRef(null);
  const appointmentList = useRef(null);
  const lastOpenedId = useRef(null);
  const focusDetail = useRef(false);
  const appointments = result?.appointments ?? [];
  const openAppointment = !professional && appointments.find((appointment) => appointment.id === openId);
  const showDetail = !!openAppointment;
  const now = new Date();
  const isUpcomingConfirmed = (appointment) => appointment.status === "confirmed"
    && new Date(appointment.starts_at.replace(" ", "T") + "+01:00") > now;
  const nextId = !professional && filter === "upcoming" && page === 1
    ? appointments.find(isUpcomingConfirmed)?.id : null;

  useEffect(() => {
    if (showDetail && focusDetail.current) {
      detailHeading.current?.focus();
      focusDetail.current = false;
    } else if (!showDetail && openId === null && lastOpenedId.current !== null) {
      Array.from(appointmentList.current?.querySelectorAll(".appointment-open") ?? [])
        .find((button) => button.value === String(lastOpenedId.current))?.focus();
      lastOpenedId.current = null;
    }
  }, [showDetail, openId]);

  function changeFilter(value) {
    if (value === filter) return;
    setOpenId(null);
    setFilter(value);
    setPage(1);
  }
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
      .then((response) => { setResult(response); setStaleIds([]); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [professional, date, filter, page, staffId, refresh]);

  async function cancel(appointment) {
    if (!validAppointmentVersion(appointment.version) || staleIds.includes(appointment.id)) return;
    const confirmation = professional
      ? "Confirmer l’annulation de ce rendez-vous ?"
      : `Annuler ce rendez-vous ?\n\n${appointment.service_name} · ${appointment.salon_name}\n${appointmentDate(appointment.starts_at)} (heure d’Algérie)\n\nSi vous l’avez ajouté à votre calendrier, vous devrez le supprimer manuellement.`;
    if (!window.confirm(confirmation)) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const response = await apiRequest("appointments.php", { csrfToken, body: { action: "cancel", appointmentId: appointment.id, expectedVersion: Number(appointment.version) } });
      setNotice(professional ? response.message : `${response.message} Un e-mail d’annulation est en attente d’envoi. Si vous avez ajouté ce rendez-vous à votre calendrier, supprimez-le manuellement.`);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(cause.message);
      if (cause.code === "appointment_changed") setStaleIds((ids) => [...ids, appointment.id]);
    }
    finally { setWorking(false); }
  }
  function modificationLink(appointment, hasDetails) {
    const params = new URLSearchParams({
      appointmentId: appointment.id,
      date: appointment.starts_at.slice(0, 10),
      version: String(appointment.version),
    });
    if (hasDetails) {
      const ids = appointment.services.map((service) => String(service.id));
      params.set(ids.length === 1 ? "serviceId" : "serviceIds", ids.join(","));
    } else params.set("unknownServices", "1");
    if (appointment.staff_id) params.set("staffId", appointment.staff_id);
    return `/salons/${appointment.salon_id}?${params}`;
  }
  return (
    <section className={`client-card${professional ? "" : " client-appointments"}`}>
      <h2 hidden={showDetail}>{professional ? "Agenda" : "Mes rendez-vous"}</h2>
      <p className="field-hint" hidden={showDetail}>{professional
        ? "Horaires d’Algérie (UTC+1). Confirmation et rappels envoyés par e-mail par la tâche cron du site."
        : "Tous les horaires sont en heure d’Algérie."}</p>
      {!professional && <div className="appointment-filters" role="group" aria-label="Filtre des rendez-vous" hidden={showDetail}>
        <button type="button" aria-pressed={filter === "upcoming"} onClick={() => changeFilter("upcoming")}>À venir</button>
        <button type="button" aria-pressed={filter === "past"} onClick={() => changeFilter("past")}>Historique</button>
      </div>}
      <div className="booking-toolbar">
        {professional && <><label>Journée <input aria-label="Journée de l’agenda" type="date" required value={date} onChange={(event) => { setDate(event.target.value); setPage(1); }} /></label>
          {staffMembers.length > 0 && <label>Collaborateur<select aria-label="Filtrer par collaborateur" value={staffId} onChange={(event) => { setStaffId(event.target.value); setPage(1); }}>
            <option value="">Toute l’équipe</option>{staffMembers.map((member) => <option key={member.id} value={member.id}>{member.name}{Number(member.is_active) ? "" : " (inactif)"}</option>)}
          </select></label>}
        </>}
        <button className="admin-nav-link" type="button" disabled={working} onClick={() => setRefresh((value) => value + 1)}>Actualiser</button>
      </div>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="form-message form-success" role="status">{notice}</p>}
      {!result && !error && <p role="status">Chargement des rendez-vous…</p>}
      {result && appointments.length === 0 && <p>{professional ? "Aucun rendez-vous dans cette sélection."
        : filter === "upcoming" ? "Vous n’avez aucun rendez-vous à venir." : "Vous n’avez aucun rendez-vous dans l’historique."}</p>}
      {showDetail && <button className="appointment-return" type="button" onClick={() => setOpenId(null)}>← Retour à mes rendez-vous</button>}
      <div className="appointment-list" ref={appointmentList}>
        {appointments.map((appointment) => {
          const editable = isUpcomingConfirmed(appointment);
          const expanded = showDetail && appointment.id === openId;
          const next = appointment.id === nextId;
          const duration = (new Date(appointment.ends_at.replace(" ", "T") + "+01:00") - new Date(appointment.starts_at.replace(" ", "T") + "+01:00")) / 60000;
          const hasDetails = validAppointmentServiceDetails(appointment, duration, appointment.service_count);
          const hasVersion = validAppointmentVersion(appointment.version);
          const stale = staleIds.includes(appointment.id);
          const appointmentPrice = validAppointmentPrice(appointment.price_dzd) ? priceLabel(appointment.price_dzd) : "Tarif indisponible";
          const cancelled = appointment.status === "cancelled";
          const past = !professional && filter === "past";
          const status = <span className={`application-status ${cancelled ? "status-rejected" : past ? "appointment-status-past" : "status-approved"}`}>{cancelled ? "Annulé" : past ? "Passé" : "Confirmé"}</span>;
          const durationLabel = Number.isSafeInteger(duration) && duration > 0 ? `${duration} min` : "Durée indisponible";
          return (
            <article className={`appointment-card${next && !expanded ? " appointment-next" : ""}`} key={appointment.id} hidden={showDetail && !expanded}>
              {!professional && <div className="appointment-preview" hidden={expanded}>
                <div className="appointment-card-heading">{next && <strong className="appointment-next-label">Prochain rendez-vous</strong>}{status}</div>
                <p className="appointment-when">{appointmentDate(appointment.starts_at)}</p>
                <h3>{appointment.service_name}</h3>
                <p>{appointment.salon_name} · {appointment.city}</p>
                <button className={next ? "auth-submit appointment-open" : "admin-nav-link appointment-open"} type="button" value={appointment.id}
                  aria-label={`Voir le détail : ${appointment.service_name}, ${appointmentDate(appointment.starts_at)}`}
                  onClick={() => {
                    lastOpenedId.current = appointment.id;
                    focusDetail.current = true;
                    setOpenId(appointment.id);
                  }}>Voir le détail</button>
              </div>}
              <div className="appointment-detail" hidden={!professional && !expanded}>
              {professional ? <>
                {status}
                <h3>{appointment.service_name}</h3>
                <p>{appointmentDate(appointment.starts_at)} · {durationLabel} · {appointmentPrice}{appointment.staff_name && <> · {appointment.staff_name}</>}</p>
              </> : <>
                <div className="appointment-card-heading"><h2 tabIndex={-1} ref={expanded ? detailHeading : null}>{appointment.salon_name}</h2>{status}</div>
                <p className="appointment-when">{appointmentDate(appointment.starts_at)} <span className="field-hint">· heure d’Algérie</span></p>
                <dl className="client-details appointment-facts">
                  <div><dt>{appointment.service_count > 1 ? "Prestations" : "Prestation"}</dt><dd>{hasDetails && appointment.services.length > 1 ? <ServiceBreakdown services={appointment.services} /> : appointment.service_name}</dd></div>
                  <div><dt>Collaborateur</dt><dd>{appointment.staff_name || "Non attribué"}</dd></div>
                  <div><dt>Durée</dt><dd>{durationLabel}</dd></div>
                  <div><dt>Total</dt><dd>{appointmentPrice}{validAppointmentPrice(appointment.price_dzd) && " · paiement sur place"}</dd></div>
                  <div><dt>Adresse</dt><dd>{appointment.address}, {appointment.city}</dd></div>
                </dl>
                {!hasDetails && <p className="form-message form-error" role="alert">Le détail des prestations est indisponible ou incohérent. Actualisez la liste ou contactez l’établissement.</p>}
              </>}
              {editable && !hasVersion && <p className="form-message form-error" role="alert">Impossible de vérifier la version du rendez-vous. Actualisez la liste avant de continuer.</p>}
              {editable && stale && <p className="form-message form-error" role="alert">Actualisez la liste avant de continuer.</p>}
              {professional && <p>{appointment.first_name} {appointment.last_name} · <a className="inline-link" href={`tel:${appointment.client_phone}`}>{appointment.client_phone}</a></p>}
              {(!professional || editable) && <div className={professional ? "review-buttons" : "booking-actions appointment-detail-actions"}>
                {!professional && editable && hasVersion && !stale && <Link className="auth-submit booking-primary-link admin-nav-link" to={modificationLink(appointment, hasDetails)}>Modifier le rendez-vous</Link>}
                {!professional && editable && <CalendarDownloadButton details={{
                  appointmentId: appointment.id, salonId: appointment.salon_id, salonName: appointment.salon_name,
                  salonAddress: `${appointment.address}, ${appointment.city}`, serviceName: appointment.service_name,
                  date: appointment.starts_at.slice(0, 10), time: appointment.starts_at.slice(11, 16),
                  durationMinutes: duration,
                  staffName: appointment.staff_name || "Non attribué", priceLabel: appointmentPrice,
                  serviceDetails: hasDetails ? calendarServiceDetails(appointment.services)
                    : ["Le détail des prestations est indisponible. Consultez votre espace client ou contactez l’établissement."],
                }} />}
                {!professional && appointment.salon_phone && <a className="appointment-call admin-nav-link" href={`tel:${appointment.salon_phone}`}>Appeler le salon</a>}
                {editable && <button className="review-reject" type="button" disabled={working || !hasVersion || stale} onClick={() => cancel(appointment)}>{professional ? "Annuler" : "Annuler le rendez-vous"}</button>}
              </div>}
              </div>
            </article>
          );
        })}
      </div>
      {result && !showDetail && (page > 1 || result.hasMore) && <nav className="pagination" aria-label="Pages des rendez-vous">
        {page > 1 && <button className="admin-nav-link" onClick={() => setPage(page - 1)} type="button">Précédent</button>}
        {result.hasMore && <button className="admin-nav-link" onClick={() => setPage(page + 1)} type="button">Suivant</button>}
      </nav>}
    </section>
  );
}
