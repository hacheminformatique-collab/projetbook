import { useCallback, useEffect, useRef, useState } from "react";
import { algerianDate, apiRequest, appointmentDate, priceLabel } from "./api-client.js";

const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const timeLabel = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const startsInFuture = (item, now = new Date()) => new Date(item.starts_at.replace(" ", "T") + "+01:00") > now;
const dayOffset = (date, offset) => {
  const value = new Date(`${date}T12:00:00+01:00`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};

function AppointmentDetail({ appointment, agenda, csrfToken, onClose, onChanged, destination }) {
  const [note, setNote] = useState(appointment.private_note);
  const [showClient, setShowClient] = useState(false);
  const [editing, setEditing] = useState(!!destination);
  const [serviceId, setServiceId] = useState(String(appointment.service_id));
  const [staffId, setStaffId] = useState(destination?.staffId ?? (agenda.staff.some((item) => Number(item.is_active) && String(item.id) === String(appointment.staff_id)) ? String(appointment.staff_id) : ""));
  const [date, setDate] = useState(destination?.date ?? appointment.starts_at.slice(0, 10));
  const [suggestedTime, setSuggestedTime] = useState(destination?.time || "");
  const [time, setTime] = useState("");
  const [slots, setSlots] = useState([]);
  const [slotError, setSlotError] = useState("");
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(null);
  const service = agenda.services.find((item) => String(item.id) === serviceId);
  const activeStaff = agenda.staff.filter((item) => Number(item.is_active));
  const editable = startsInFuture(appointment);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest("[role=dialog]");
      const focusable = dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previous?.focus(); };
  }, [onClose]);
  useEffect(() => {
    setTime("");
    setSlots([]);
    setSlotError("");
    setLoadingSlots(false);
    if (!editing || !service || !date || (activeStaff.length > 0 && !staffId)) return undefined;
    const controller = new AbortController();
    setLoadingSlots(true);
    const query = new URLSearchParams({ salonId: agenda.salonId, serviceId, date, appointmentId: appointment.id });
    if (staffId) query.set("staffId", staffId);
    apiRequest(`availability.php?${query}`, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setSlots(response.slots);
        if (response.slots.includes(suggestedTime)) setTime(suggestedTime);
      })
      .catch((error) => { if (!controller.signal.aborted) setSlotError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingSlots(false); });
    return () => controller.abort();
  }, [editing, service, serviceId, staffId, date, agenda.salonId, appointment.id, activeStaff.length, suggestedTime]);

  useEffect(() => {
    if (destination) closeRef.current?.closest("[role=dialog]")?.querySelector(".agenda-edit")?.scrollIntoView({ block: "nearest" });
  }, [destination]);

  async function saveNote(event) {
    event.preventDefault();
    if (new TextEncoder().encode(note).length > 4000) {
      setNotice({ error: true, text: "La note ne doit pas dépasser 4 000 octets." });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiRequest("professional-agenda.php", {
        csrfToken, body: { appointmentId: Number(appointment.id), note },
      });
      onChanged(true, response.message);
    } catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(false); }
  }
  async function reschedule(event) {
    event.preventDefault();
    if (!service || loadingSlots || !slots.includes(time) || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiRequest("appointments.php", {
        csrfToken, body: {
          action: "reschedule", appointmentId: Number(appointment.id), serviceId: Number(serviceId),
          ...(staffId ? { staffId: Number(staffId) } : {}), date, time,
          expectedPrice: Number(service.price_dzd), expectedDuration: Number(service.duration_minutes),
        },
      });
      onChanged(true, response.message, date);
    } catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm("Confirmer l’annulation de ce rendez-vous ?")) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await apiRequest("appointments.php", { csrfToken, body: { action: "cancel", appointmentId: Number(appointment.id) } });
      onChanged(true, response.message);
    } catch (error) { setNotice({ error: true, text: error.message }); }
    finally { setBusy(false); }
  }
  return <div className="agenda-backdrop">
    <section className="agenda-detail" role="dialog" aria-modal="true" aria-labelledby="agenda-detail-title">
      <header className="agenda-detail-header">
        <h2 id="agenda-detail-title">Fiche rendez-vous</h2>
        <button ref={closeRef} type="button" className="admin-nav-link" onClick={onClose}>Fermer</button>
      </header>
      <p><strong>{appointment.service_name}</strong><br />{appointmentDate(appointment.starts_at)} · {priceLabel(appointment.price_dzd)}<br />
        Durée : {(new Date(appointment.ends_at.replace(" ", "T") + "+01:00") - new Date(appointment.starts_at.replace(" ", "T") + "+01:00")) / 60000} min<br />
        Collaborateur : {agenda.staff.find((member) => String(member.id) === String(appointment.staff_id))?.name || "Non attribué"}
      </p>
      <button type="button" className="agenda-client-link" onClick={() => setShowClient(!showClient)} aria-expanded={showClient}>
        {appointment.first_name} {appointment.last_name}
      </button>
      {showClient && <section className="agenda-client-info">
        <h3>Fiche client</h3>
        <p>Téléphone : <a href={`tel:${appointment.phone_number}`}>{appointment.phone_number}</a><br />
          E-mail : <a href={`mailto:${appointment.email}`}>{appointment.email}</a><br />
          Date de naissance : {appointment.date_of_birth.split("-").reverse().join("/")}
        </p>
      </section>}
      {notice && <p className={`form-message ${notice.error ? "form-error" : "form-success"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p>}
      <form className="auth-form" onSubmit={saveNote}>
        <label>Note privée du rendez-vous<textarea value={note} maxLength={4000} rows={3} onChange={(event) => setNote(event.target.value)} />
          <span className="field-hint">Visible uniquement par le professionnel du salon, jamais dans les e-mails au client.</span>
        </label>
        <button type="submit" className="admin-nav-link" disabled={busy}>Enregistrer la note</button>
      </form>
      {editable && <div className="review-buttons">
        <button className="admin-nav-link" type="button" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? "Fermer la modification" : "Modifier le rendez-vous"}</button>
        <button className="review-reject" type="button" disabled={busy} onClick={cancel}>Annuler le rendez-vous</button>
      </div>}
      {editing && <form className="auth-form agenda-edit" onSubmit={reschedule}>
        {suggestedTime && <p className="field-hint">Déplacement proposé à {suggestedTime}. {loadingSlots ? "" : slots.includes(suggestedTime) ? "Confirmez pour enregistrer." : "Ce créneau ne convient pas à la prestation. Choisissez un autre horaire."}</p>}
        <p className="field-hint">La prestation sera enregistrée au tarif et à la durée affichés ci-dessous. Le rendez-vous initial reste inchangé si le créneau est indisponible.</p>
        <label>Prestation<select value={serviceId} required onChange={(event) => { setSuggestedTime(""); setServiceId(event.target.value); }}>
          {!service && <option value={serviceId} disabled>Prestation actuelle indisponible — choisissez une prestation</option>}
          {agenda.services.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.duration_minutes} min · {priceLabel(item.price_dzd)}</option>)}
        </select></label>
        {activeStaff.length > 0 && <label>Collaborateur<select value={staffId} required onChange={(event) => { setSuggestedTime(""); setStaffId(event.target.value); }}>
          <option value="">Choisir un collaborateur</option>
          {activeStaff.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>}
        <label>Date<input type="date" min={algerianDate()} max={algerianDate(60)} required value={date} onChange={(event) => { setSuggestedTime(""); setDate(event.target.value); }} /></label>
        {loadingSlots && <p role="status">Recherche des créneaux…</p>}
        {slotError && <p className="form-message form-error" role="alert">{slotError}</p>}
        {!loadingSlots && !slotError && slots.length === 0 && <p>Aucun créneau disponible pour cette sélection.</p>}
        <label>Horaire<select value={time} required onChange={(event) => setTime(event.target.value)} disabled={loadingSlots || slots.length === 0}>
          <option value="">Choisir un horaire</option>{slots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
        </select></label>
        <button className="auth-submit" type="submit" disabled={busy || !service || !time || !!slotError}>Enregistrer la modification</button>
      </form>}
    </section>
  </div>;
}

export default function ProfessionalAgenda({ csrfToken, date, setDate }) {
  const [agenda, setAgenda] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [dropTarget, setDropTarget] = useState("");
  const [staffFilter, setStaffFilter] = useState("");
  const scrollRef = useRef(null);
  const closeDetail = useCallback(() => setSelected(null), []);
  useEffect(() => {
    setSelected(null);
  }, [date]);
  useEffect(() => {
    const controller = new AbortController();
    setAgenda(null);
    setError("");
    apiRequest(`professional-agenda.php?${new URLSearchParams({ date })}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setAgenda(result); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [date, revision]);
  useEffect(() => {
    if (agenda && scrollRef.current) scrollRef.current.scrollTop = 8 * 4 * 24;
  }, [agenda]);

  const visibleStaff = agenda?.staff.filter((member) => Number(member.is_active) || agenda.appointments.some((item) => String(item.staff_id) === String(member.id))) || [];
  const hasActiveStaff = visibleStaff.some((member) => Number(member.is_active));
  const unassigned = agenda?.appointments.filter((item) => !item.staff_id) || [];
  const columns = [
    ...visibleStaff,
    ...(!hasActiveStaff || unassigned.length ? [{
      id: "", name: hasActiveStaff ? "Non attribués" : "Agenda du salon",
      opens_at: agenda?.hours?.opens_at, closes_at: agenda?.hours?.closes_at,
    }] : []),
  ];
  const filtered = staffFilter && columns.some((member) => String(member.id) === staffFilter)
    ? columns.filter((member) => String(member.id) === staffFilter) : columns;
  const rows = Array.from({ length: 96 }, (_, index) => index * 15);
  const maxBookingDate = algerianDate(60);
  const now = new Date();
  function changed(close, message, nextDate) {
    if (close) setSelected(null);
    if (message) setNotice(message);
    if (nextDate && nextDate !== date) setDate(nextDate);
    else setRevision((value) => value + 1);
  }
  return <div className="pro-agenda">
    <div className="agenda-toolbar">
      <button className="admin-nav-link" type="button" onClick={() => { setDate(dayOffset(date, -1)); setSelected(null); }}>‹ Jour précédent</button>
      <label>Journée<input type="date" value={date} onChange={(event) => { if (event.target.value) { setDate(event.target.value); setSelected(null); } }} /></label>
      <button className="admin-nav-link" type="button" onClick={() => { setDate(algerianDate()); setSelected(null); }}>Aujourd’hui</button>
      <button className="admin-nav-link" type="button" onClick={() => { setDate(dayOffset(date, 1)); setSelected(null); }}>Jour suivant ›</button>
      <label>Collaborateur<select value={staffFilter} onChange={(event) => setStaffFilter(event.target.value)}>
        <option value="">Toute l’équipe</option>{visibleStaff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
      </select></label>
      <button className="admin-nav-link" type="button" onClick={() => { setSelected(null); setRevision((value) => value + 1); }}>Actualiser</button>
    </div>
    <p className="field-hint">Heures d’Algérie · Ouvrez un rendez-vous pour le modifier, ou faites-le glisser sur ordinateur puis confirmez. La disponibilité dépend de la durée de la prestation.</p>
    {notice && <p className="form-message form-success" role="status">{notice}</p>}
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    {!agenda && !error && <p role="status">Chargement de l’agenda…</p>}
    {agenda?.date === date && <div className="agenda-scroll" ref={scrollRef} tabIndex={0} aria-label="Grille des rendez-vous, défilement horizontal et vertical">
      <div className="agenda-grid" style={{ gridTemplateColumns: `64px repeat(${filtered.length}, minmax(190px, 1fr))` }}>
        <div className="agenda-corner">Heure</div>
        {filtered.map((member) => <div className="agenda-column-title" key={member.id || "unassigned"}>{member.name}{member.id && !Number(member.is_active) ? " (inactif)" : ""}</div>)}
        <div className="agenda-times">{rows.map((row) => <div key={row}>{row % 60 === 0 ? timeLabel(row) : ""}</div>)}</div>
        {filtered.map((member) => {
          const bookings = agenda.appointments.filter((item) => String(item.staff_id || "") === String(member.id || ""));
          const blocked = agenda.appointments.filter((item) => member.id ? !item.staff_id : !hasActiveStaff && item.staff_id);
          const open = !agenda.closed && agenda.hours && member.opens_at && (member.id ? Number(member.is_active) : !hasActiveStaff);
          const start = open ? Math.max(minutes(agenda.hours.opens_at), minutes(member.opens_at)) : 0;
          const end = open ? Math.min(minutes(agenda.hours.closes_at), minutes(member.closes_at)) : 0;
          return <div className="agenda-day-column" key={member.id || "unassigned"}>
            {rows.map((row) => {
              const targetTime = start + Math.ceil((row - start) / 15) * 15;
              const canDrop = open && date <= maxBookingDate && targetTime >= start && targetTime + 15 <= end
                && new Date(`${date}T${timeLabel(targetTime)}:00+01:00`) > now;
              const busy = [...bookings, ...blocked].some((item) => {
                const from = item.starts_at.slice(0, 10) < date ? 0 : minutes(item.starts_at.slice(11, 16));
                const to = item.ends_at.slice(0, 10) > date ? 1440 : minutes(item.ends_at.slice(11, 16));
                return targetTime < to && targetTime + 15 > from;
              });
              const free = canDrop && !busy;
              const targetKey = `${member.id}:${row}`;
              return <div key={row} className={`agenda-slot ${free ? "agenda-slot-free" : "agenda-slot-unavailable"}${dropTarget === targetKey ? " agenda-drop-target" : ""}`} aria-label={`${timeLabel(canDrop ? targetTime : row)} : ${free ? "libre" : busy ? "occupé" : "indisponible"}`}
                onDragOver={free ? (event) => {
                  if (!event.dataTransfer.types.includes("application/x-bookili-appointment")) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropTarget(targetKey);
                } : undefined}
                onDragLeave={free ? () => setDropTarget("") : undefined}
                onDrop={free ? (event) => {
                  event.preventDefault();
                  setDropTarget("");
                  const id = event.dataTransfer.getData("application/x-bookili-appointment");
                  const appointment = agenda.appointments.find((item) => String(item.id) === id && startsInFuture(item));
                  if (appointment) setSelected({ appointment, destination: { date, staffId: String(member.id), time: timeLabel(targetTime) } });
                } : undefined}
              />;
            })}
            {bookings.map((item) => {
              const from = item.starts_at.slice(0, 10) < date ? 0 : minutes(item.starts_at.slice(11, 16));
              const to = item.ends_at.slice(0, 10) > date ? 1440 : minutes(item.ends_at.slice(11, 16));
              const draggable = startsInFuture(item, now);
              return <button type="button" key={item.id} className="agenda-booking" draggable={draggable} style={{ top: `${from / 15 * 24}px`, height: `${(to - from) / 15 * 24}px` }}
                onDragStart={draggable ? (event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-bookili-appointment", String(item.id));
                } : undefined}
                onDragEnd={() => setDropTarget("")}
                onClick={() => setSelected({ appointment: item })}>
                <strong>{item.starts_at.slice(11, 16)}–{item.ends_at.slice(11, 16)} · {item.first_name} {item.last_name}</strong><span>{item.service_name}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
    </div>}
    {selected && agenda?.date === date && <AppointmentDetail key={selected.appointment.id} {...selected} agenda={agenda} csrfToken={csrfToken} onClose={closeDetail} onChanged={changed} />}
  </div>;
}
