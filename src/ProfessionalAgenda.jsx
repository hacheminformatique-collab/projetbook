import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { algerianDate, apiRequest, appointmentDate, priceLabel } from "./api-client.js";

const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const timeLabel = (value) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
const startsInFuture = (item, now = new Date()) => new Date(item.starts_at.replace(" ", "T") + "+01:00") > now;
const dayOffset = (date, offset) => {
  const value = new Date(`${date}T12:00:00+01:00`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const localClock = new Intl.DateTimeFormat("fr-DZ", { timeZone: "Africa/Algiers", hourCycle: "h23", hour: "2-digit", minute: "2-digit" });
const shortDay = new Intl.DateTimeFormat("fr-DZ", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const utcDate = (date) => new Date(`${date}T12:00:00Z`);
function weekStart(date) {
  return dayOffset(date, -((utcDate(date).getUTCDay() + 6) % 7));
}
function weekNumber(monday) {
  const thursday = utcDate(dayOffset(monday, 3));
  return Math.ceil(((thursday - Date.UTC(thursday.getUTCFullYear(), 0, 1, 12)) / 86400000 + 1) / 7);
}
function bounds(item, date) {
  return [
    item.starts_at.slice(0, 10) < date ? 0 : minutes(item.starts_at.slice(11, 16)),
    item.ends_at.slice(0, 10) > date ? 1440 : minutes(item.ends_at.slice(11, 16)),
  ];
}

function AppointmentDetail({ appointment, agenda, csrfToken, onClose, onChanged, destination }) {
  const [note, setNote] = useState(appointment.private_note);
  const [showClient, setShowClient] = useState(false);
  const [history, setHistory] = useState(null);
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
    const controller = new AbortController();
    apiRequest(`professional-agenda.php?${new URLSearchParams({ historyFor: appointment.id })}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setHistory(result); })
      .catch((cause) => { if (!controller.signal.aborted) setHistory({ error: cause.message }); });
    return () => controller.abort();
  }, [appointment.id]);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const handleKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const dialog = closeRef.current?.closest("[role=dialog]");
      const focusable = dialog?.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary');
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
      <details className="agenda-history">
        <summary>Notes des précédents rendez-vous</summary>
        {!history && <p role="status">Chargement des notes…</p>}
        {history?.error && <p role="alert">{history.error}</p>}
        {history?.history?.length === 0 && <p>Aucune note sur les rendez-vous passés de ce client dans votre salon.</p>}
        {history?.history?.map((item) => <article key={item.id}>
          <strong>{appointmentDate(item.starts_at)} · {item.service_name}</strong>
          <p>{item.note}</p>
        </article>)}
      </details>
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

export default function ProfessionalAgenda({ csrfToken, date, setDate, filtersTarget }) {
  const [response, setResponse] = useState(null);
  const [view, setView] = useState("day");
  const [scale, setScale] = useState(30);
  const [fullDay, setFullDay] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [dropTarget, setDropTarget] = useState("");
  const [hiddenStaff, setHiddenStaff] = useState([]);
  const monday = weekStart(date);
  const firstDay = view === "week" ? monday : date;
  const dayCount = view === "week" ? 7 : 1;
  const current = response?.firstDay === firstDay && response.dayCount === dayCount && response.revision === revision ? response : null;
  const days = current?.days;
  const closeDetail = useCallback(() => setSelected(null), []);
  useEffect(() => {
    setSelected(null);
  }, [date]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 5000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const fetchDay = (index) => apiRequest(`professional-agenda.php?${new URLSearchParams({ date: dayOffset(firstDay, index) })}`, { signal: controller.signal });
    Promise.all(Array.from({ length: dayCount }, (_, index) => fetchDay(index)))
      .then((days) => { if (!controller.signal.aborted) setResponse({ firstDay, dayCount, revision, days }); })
      .catch((cause) => { if (!controller.signal.aborted) setResponse({ firstDay, dayCount, revision, error: cause.message }); });
    return () => controller.abort();
  }, [firstDay, dayCount, revision]);

  const appointments = days?.flatMap((day) => day.appointments) ?? [];
  const assigned = new Set(appointments.map((item) => String(item.staff_id || "")));
  const team = days?.[0].staff.filter((member) => Number(member.is_active) || assigned.has(String(member.id))) ?? [];
  const hasActiveStaff = team.some((member) => Number(member.is_active));
  const people = [...team, ...(!hasActiveStaff || assigned.has("") ? [{ id: "", name: hasActiveStaff ? "Non attribués" : "Agenda du salon" }] : [])];
  const visible = people.filter((member) => !hiddenStaff.includes(String(member.id)));
  const columns = days?.flatMap((day) => visible.map((member) => ({ day, member }))) ?? [];
  const ranges = days?.flatMap((day) => [
    ...(!day.closed && day.hours ? [[minutes(day.hours.opens_at), minutes(day.hours.closes_at)]] : []),
    ...day.appointments.map((item) => bounds(item, day.date)),
  ]) ?? [];
  const start = fullDay ? 0 : ranges.length ? Math.floor(Math.min(...ranges.map(([from]) => from)) / 15) * 15 : 8 * 60;
  const end = fullDay ? 1440 : ranges.length ? Math.ceil(Math.max(...ranges.map(([, to]) => to)) / 15) * 15 : 18 * 60;
  const unit = 40 / scale;
  const rows = Array.from({ length: (end - start) / 15 }, (_, index) => start + index * 15);
  const maxBookingDate = algerianDate(60);
  const selectedDay = days?.find((day) => day.date === selected?.sourceDate);
  const filters = days && <fieldset className="agenda-filters"><legend>Collaborateurs</legend>
    <label><input type="checkbox" checked={visible.length === people.length} ref={(input) => { if (input) input.indeterminate = visible.length > 0 && visible.length < people.length; }}
      onChange={(event) => setHiddenStaff(event.target.checked ? [] : people.map((member) => String(member.id)))} /> Toute l’équipe</label>
    {people.map((member) => <label key={member.id}>
      <input type="checkbox" checked={!hiddenStaff.includes(String(member.id))} onChange={(event) => {
        const id = String(member.id);
        const checked = event.target.checked;
        setHiddenStaff((ids) => checked ? ids.filter((value) => value !== id) : [...ids, id]);
      }} /> {member.name}{member.id && !Number(member.is_active) ? " (inactif)" : ""}
    </label>)}
  </fieldset>;
  function navigateDate(value) {
    setSelected(null);
    setDate(value);
  }
  function changed(close, message, nextDate) {
    if (close) setSelected(null);
    if (message) setNotice(message);
    if (nextDate && nextDate !== date) setDate(nextDate);
    else setRevision((value) => value + 1);
  }
  return <div className="pro-agenda">
    <div className="agenda-toolbar">
      <button className="admin-nav-link" type="button" onClick={() => navigateDate(algerianDate())}>Aujourd’hui</button>
      <button className="admin-nav-link" type="button" aria-label={view === "day" ? "Jour précédent" : "Semaine précédente"} onClick={() => navigateDate(dayOffset(date, -dayCount))}>‹</button>
      <button className="admin-nav-link" type="button" aria-label={view === "day" ? "Jour suivant" : "Semaine suivante"} onClick={() => navigateDate(dayOffset(date, dayCount))}>›</button>
      <button className="admin-nav-link agenda-view" type="button" aria-pressed={view === "day"} onClick={() => { setSelected(null); setView("day"); }}>Vue jour<small>{shortDay.format(utcDate(date))}</small></button>
      <button className="admin-nav-link agenda-view" type="button" aria-pressed={view === "week"} onClick={() => { setSelected(null); setView("week"); }}>Vue semaine<small>Semaine {weekNumber(monday)}</small></button>
      <label>Échelle<select value={scale} onChange={(event) => setScale(Number(event.target.value))}>
        <option value={15}>15 min</option><option value={30}>30 min</option><option value={60}>1 h</option><option value={120}>2 h</option>
      </select></label>
      <time className="agenda-clock" aria-label="Heure actuelle en Algérie">{localClock.format(now)}</time>
      <button className="admin-nav-link" type="button" onClick={() => { setSelected(null); setRevision((value) => value + 1); }}>Actualiser</button>
    </div>
    <div className="agenda-planning-options">
      {filtersTarget ? createPortal(filters, filtersTarget) : filters}
      <label className="agenda-full-day"><input type="checkbox" checked={fullDay} onChange={(event) => setFullDay(event.target.checked)} /> Afficher de 0 h à 24 h</label>
    </div>
    <p className="field-hint">Heures d’Algérie · Ouvrez un rendez-vous pour le modifier, ou faites-le glisser sur ordinateur puis confirmez.</p>
    {notice && <p className="form-message form-success" role="status">{notice}</p>}
    {current?.error && <p className="form-message form-error" role="alert">{current.error}</p>}
    {!current && <p role="status">Chargement de l’agenda…</p>}
    {days && !columns.length && <p role="status">Cochez un collaborateur pour afficher sa colonne.</p>}
    {columns.length > 0 && <div className="agenda-scroll" tabIndex={0} aria-label="Grille des rendez-vous, défilement horizontal et vertical">
      <div className="agenda-grid" style={{ "--agenda-row": `${15 * unit}px`, gridTemplateColumns: `64px repeat(${columns.length}, minmax(${view === "day" ? 180 : 142}px, 1fr))` }}>
        <div className="agenda-corner">Heure</div>
        {columns.map(({ day, member }) => <div className="agenda-column-title" key={`${day.date}:${member.id}`}>
          {view === "week" && <button type="button" onClick={() => { navigateDate(day.date); setView("day"); }}>{shortDay.format(utcDate(day.date))}</button>}
          {member.name}{day.closed && <small> · Fermé</small>}
        </div>)}
        <div className="agenda-times">{rows.map((row) => <div key={row}>{(row - start) % scale === 0 && <span className="agenda-time-label">{timeLabel(row)}</span>}</div>)}</div>
        {columns.map(({ day, member }) => {
          const bookings = day.appointments.filter((item) => String(item.staff_id || "") === String(member.id));
          const blocked = day.appointments.filter((item) => member.id ? !item.staff_id : !hasActiveStaff && item.staff_id);
          const busyRanges = [...bookings, ...blocked].map((item) => bounds(item, day.date));
          const hours = member.id ? day.staff.find((item) => item.id === member.id) : day.hours;
          const open = !day.closed && day.hours && hours?.opens_at && (member.id ? Number(hours.is_active) : !hasActiveStaff);
          const opens = open ? Math.max(minutes(day.hours.opens_at), minutes(hours.opens_at)) : 0;
          const closes = open ? Math.min(minutes(day.hours.closes_at), minutes(hours.closes_at)) : 0;
          return <div className="agenda-day-column" key={`${day.date}:${member.id}`}>
            {rows.map((row) => {
              const targetTime = opens + Math.ceil((row - opens) / 15) * 15;
              const canDrop = open && day.date <= maxBookingDate && targetTime >= opens && targetTime + 15 <= closes
                && new Date(`${day.date}T${timeLabel(targetTime)}:00+01:00`) > now;
              const busy = busyRanges.some(([from, to]) => targetTime < to && targetTime + 15 > from);
              const free = canDrop && !busy;
              const targetKey = `${day.date}:${member.id}:${row}`;
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
                  const source = days.find((entry) => entry.appointments.some((item) => String(item.id) === id));
                  const appointment = source?.appointments.find((item) => String(item.id) === id && startsInFuture(item));
                  if (appointment) setSelected({ appointment, sourceDate: source.date, destination: { date: day.date, staffId: String(member.id), time: timeLabel(targetTime) } });
                } : undefined}
              />;
            })}
            {bookings.map((item) => {
              const [from, to] = bounds(item, day.date);
              const draggable = startsInFuture(item, now);
              const label = `${item.starts_at.slice(11, 16)}–${item.ends_at.slice(11, 16)} · ${item.first_name} ${item.last_name}`;
              return <button type="button" key={item.id} className="agenda-booking" title={`${label} · ${item.service_name}`} draggable={draggable} style={{ top: `${(from - start) * unit}px`, height: `${(to - from) * unit}px`, paddingBlock: (to - from) * unit < 17 ? 0 : undefined }}
                onDragStart={draggable ? (event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-bookili-appointment", String(item.id));
                } : undefined}
                onDragEnd={() => setDropTarget("")}
                onClick={() => setSelected({ appointment: item, sourceDate: day.date })}>
                <strong>{label}</strong><span>{item.service_name}</span>
              </button>;
            })}
          </div>;
        })}
      </div>
    </div>}
    {selected && selectedDay && <AppointmentDetail key={selected.appointment.id} {...selected} agenda={selectedDay} csrfToken={csrfToken} onClose={closeDetail} onChanged={changed} />}
  </div>;
}
