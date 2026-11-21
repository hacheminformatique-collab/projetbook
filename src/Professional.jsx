import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ProfessionalAgenda from "./ProfessionalAgenda.jsx";
import AgendaCalendar from "./AgendaCalendar.jsx";
import CashRegister from "./CashRegister.jsx";
import ProfessionalClients from "./ProfessionalClients.jsx";
import AgendaDisplaySettings from "./AgendaDisplaySettings.jsx";
import ProfessionalProfile from "./ProfessionalProfile.jsx";
import ProfessionalPhotos from "./ProfessionalPhotos.jsx";
import StaffAbsences from "./StaffAbsences.jsx";
import AlgerianCityInput from "./AlgerianCityInput.jsx";
import { InstallLink } from "./PwaInstall.jsx";
import { algerianDate, apiRequest, priceLabel, serviceCategories, weekDays } from "./api-client.js";
import { algerianWilayas } from "./data/algerian-wilayas.js";

const workspaceTabs = [["agenda", "Agenda"], ["caisse", "Caisse"], ["clients", "Clients"], ["admin", "Admin"]];
const workspaceViews = {
  agenda: [["planning", "Planning"], ["closures", "Fermetures exceptionnelles"], ["staff-absences", "Absences collaborateurs"]],
  caisse: [["cash", "Caisse et suivi des ventes"]],
  clients: [["directory", "Fichier clients"]],
  admin: [["services", "Prestations"], ["staff", "Collaborateurs"], ["agenda-display", "Affichage agenda"], ["salon", "Salon et horaires"], ["profile", "Descriptif établissement"], ["photos", "Gestion des photos"]],
};

export default function ProfessionalSpace() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [configuration, setConfiguration] = useState(null);
  const [tab, setTab] = useState("agenda");
  const [view, setView] = useState(workspaceViews.agenda[0][0]);
  const [agendaDate, setAgendaDate] = useState(algerianDate);
  const [agendaFilters, setAgendaFilters] = useState(null);
  const [cashAppointment, setCashAppointment] = useState(null);
  const [cashSaleId, setCashSaleId] = useState(null);
  const [error, setError] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const user = await apiRequest("session.php", { signal: controller.signal });
        if (!user.authenticated || user.account?.role !== "professional") {
          navigate("/professionnels", { replace: true });
          return;
        }
        const result = await apiRequest("professional-salon.php", { signal: controller.signal });
        setSession(user);
        setConfiguration(result);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause.message);
      }
    }
    load();
    return () => controller.abort();
  }, [navigate]);

  async function logout() {
    try {
      await apiRequest("logout.php", { csrfToken: session.csrfToken, body: {} });
      navigate("/professionnels", { replace: true });
    } catch (cause) { setError(cause.message); }
  }
  return (
    <div className={`pro-workspace${view === "planning" ? " pro-planning" : ""}${mobileMenu ? " pro-menu-open" : ""}`}>
      <header className="pro-topbar">
        <Link className="pro-salon-name" to="/" aria-label={`${configuration?.salon.name || "BOOKILI"} — Accueil BOOKILI`}>
          {configuration?.salon.name || "BOOKILI"}
        </Link>
        {configuration && <nav className="pro-tabs" aria-label="Espace professionnel">
          {workspaceTabs.map(([value, name]) => (
            <button key={value} type="button" aria-current={tab === value ? "page" : undefined} onClick={() => {
              if (value !== tab) {
                setCashSaleId(null);
                setTab(value);
                setView(workspaceViews[value][0][0]);
              }
              setMobileMenu(false);
            }}>{name}</button>
          ))}
        </nav>}
        <div className="pro-session">
          <button className="pro-mobile-menu" type="button" aria-expanded={mobileMenu} aria-controls="pro-sidebar" onClick={() => setMobileMenu(!mobileMenu)}>Menu</button>
          {session && <button type="button" onClick={logout}>Se déconnecter</button>}
        </div>
      </header>
      <div className="pro-layout">
        {configuration && <aside className="pro-sidebar" id="pro-sidebar">
          {view === "planning" && <>
            <AgendaCalendar key={agendaDate.slice(0, 7)} date={agendaDate} onChange={setAgendaDate} />
            <div className="agenda-sidebar-filters" ref={setAgendaFilters} />
          </>}
          <nav aria-label={`Rubriques ${workspaceTabs.find(([value]) => value === tab)[1]}`}>
            {workspaceViews[tab].map(([value, label]) => (
              <button key={value} type="button" aria-current={view === value ? "page" : undefined} onClick={() => { setView(value); setMobileMenu(false); }}>{label}</button>
            ))}
          </nav>
          {Number(configuration.salon.is_public)
            ? <Link className="pro-public-link" to={`/salons/${configuration.salon.id}`}>Voir ma page publique</Link>
            : <p className="pro-public-link">Salon non publié</p>}
          <InstallLink pro />
        </aside>}
        <main className="pro-panel">
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          {!configuration && !error && <p role="status">Chargement de votre espace…</p>}
          {configuration && <>
            <h1 className={view === "planning" ? "visually-hidden" : undefined}>{workspaceViews[tab].find(([value]) => value === view)[1]}</h1>
            {view === "planning" && <ProfessionalAgenda csrfToken={session.csrfToken} date={agendaDate} setDate={setAgendaDate} filtersTarget={agendaFilters} onCheckout={(appointment) => {
              setCashAppointment(appointment);
              setCashSaleId(null);
              setTab("caisse");
              setView("cash");
            }} onViewSale={(saleId) => {
              setCashAppointment(null);
              setCashSaleId(saleId);
              setTab("caisse");
              setView("cash");
            }} />}
            {view === "closures" && <ClosureSettings csrfToken={session.csrfToken} />}
            {view === "staff-absences" && <StaffAbsences csrfToken={session.csrfToken} />}
            {view === "cash" && <CashRegister csrfToken={session.csrfToken} appointment={cashAppointment} initialSaleId={cashSaleId} onAppointmentHandled={() => setCashAppointment(null)} />}
            {view === "directory" && <ProfessionalClients csrfToken={session.csrfToken} />}
            {view === "services" && <ServiceSettings csrfToken={session.csrfToken} />}
            {view === "staff" && <StaffSettings csrfToken={session.csrfToken} salonHours={configuration.hours} />}
            {view === "agenda-display" && <AgendaDisplaySettings csrfToken={session.csrfToken} />}
            {view === "salon" && <SalonSettings configuration={configuration} csrfToken={session.csrfToken} onSaved={setConfiguration} onNavigate={setView} />}
            {view === "profile" && <ProfessionalProfile csrfToken={session.csrfToken} onOpenPhotos={() => setView("photos")} />}
            {view === "photos" && <ProfessionalPhotos csrfToken={session.csrfToken} />}
          </>}
        </main>
      </div>
    </div>
  );
}
function staffHoursForm(staffHours = []) {
  return weekDays.map((_, index) => {
    const weekday = index + 1;
    const row = staffHours.find((hour) => Number(hour.weekday) === weekday);
    return {
      weekday, enabled: !!row,
      opens_at: row?.opens_at.slice(0, 5) || "09:00",
      closes_at: row?.closes_at.slice(0, 5) || "18:00",
      pause_starts_at: row?.pause_starts_at?.slice(0, 5) || "",
      pause_ends_at: row?.pause_ends_at?.slice(0, 5) || "",
    };
  });
}

function useSettingsEditor() {
  const [open, setOpen] = useState(false);
  const heading = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (open) heading.current?.focus();
    else trigger.current?.focus();
  }, [open]);
  return {
    open, heading,
    start(event) {
      trigger.current = event.currentTarget;
      if (open) heading.current?.focus();
      setOpen(true);
    },
    close: () => setOpen(false),
  };
}

function SettingsStatus({ active, activeText, inactiveText }) {
  return <span className={`pro-settings-status${active ? " pro-settings-status-active" : ""}`}>{active ? activeText : inactiveText}</span>;
}

function StaffSettings({ csrfToken, salonHours }) {
  const defaultHours = () => staffHoursForm(salonHours).map((hour) => ({ ...hour, pause_starts_at: "", pause_ends_at: "" }));
  const [staff, setStaff] = useState(null);
  const [editing, setEditing] = useState(() => ({ name: "", isActive: true, hours: defaultHours() }));
  const editor = useSettingsEditor();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest("professional-staff.php", { signal: controller.signal })
      .then((result) => setStaff(result.staff))
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, []);
  function changeHour(index, changes) {
    setEditing((current) => ({
      ...current,
      hours: current.hours.map((hour, currentIndex) => currentIndex === index ? { ...hour, ...changes } : hour),
    }));
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-staff.php", {
        csrfToken,
        body: {
          action: "save", ...editing,
          hours: editing.hours.filter((hour) => hour.enabled).map(({ weekday, opens_at, closes_at, pause_starts_at, pause_ends_at }) => ({ weekday, opens_at, closes_at, pause_starts_at, pause_ends_at })),
        },
      });
      setStaff(result.staff);
      editor.close();
      setNotice({ kind: "success", text: result.message });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  function openEditor(event, member) {
    setEditing(member
      ? { staffId: Number(member.id), name: member.name, isActive: Number(member.is_active) === 1, hours: staffHoursForm(member.hours) }
      : { name: "", isActive: true, hours: defaultHours() });
    setNotice(null);
    editor.start(event);
  }
  return <section className={`client-card pro-settings${editor.open ? " pro-settings-open" : ""}`}>
    <div className="pro-settings-header">
      <h2>Collaborateurs</h2>
      {staff && <button className="auth-submit" disabled={saving} type="button" onClick={(event) => openEditor(event)}>+ Ajouter un collaborateur</button>}
    </div>
    {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    {staff === null && !notice && <p role="status">Chargement…</p>}
    <div className="pro-settings-body">
    {staff && <div className="pro-settings-list service-list">
      <h3>Équipe</h3>
      {staff.length === 0 && <p>Aucun collaborateur. Ajoutez votre premier membre d’équipe.</p>}
      {staff.map((member) => <div className={`pro-settings-row${editor.open && editing.staffId === Number(member.id) ? " pro-settings-selected" : ""}`} key={member.id}>
        <strong>{member.name}</strong>
        <SettingsStatus active={Number(member.is_active) === 1} activeText="Actif" inactiveText="Inactif" />
        <button type="button" className="admin-nav-link" disabled={saving} aria-label={`Modifier ${member.name}`} onClick={(event) => openEditor(event, member)}>Modifier</button>
      </div>)}
    </div>}
    {editor.open && <form className="auth-form pro-settings-editor" onSubmit={submit}>
      <div>
        <button className="pro-settings-back admin-nav-link" type="button" disabled={saving} onClick={editor.close}>← Retour aux collaborateurs</button>
        <h3 ref={editor.heading} tabIndex={-1}>{editing.staffId ? "Modifier le collaborateur" : "Ajouter un collaborateur"}</h3>
      </div>
      <fieldset className="form-fieldset" disabled={saving}>
        <label>Nom affiché<input required maxLength={120} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />Collaborateur actif et réservable</label>
        {editing.staffId && <p className="pro-settings-note">Une désactivation retire ses futurs créneaux de la réservation en ligne sans annuler les rendez-vous déjà pris.</p>}
        <div className="hours-list">
          <h4>Horaires et pauses</h4>
          <p className="field-hint">Les créneaux respectent les horaires du salon, ceux du collaborateur et ses pauses.</p>
          {editing.hours.map((hour, index) => (
            <div className="hours-row" key={hour.weekday}>
              <label className="checkbox-label"><input type="checkbox" checked={hour.enabled} onChange={(event) => changeHour(index, { enabled: event.target.checked })} />{weekDays[index]}</label>
              <label>Ouverture<input aria-label={`Ouverture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.opens_at} onChange={(event) => changeHour(index, { opens_at: event.target.value })} /></label>
              <label>Fermeture<input aria-label={`Fermeture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.closes_at} onChange={(event) => changeHour(index, { closes_at: event.target.value })} /></label>
              <label>Début pause<input aria-label={`Début pause ${weekDays[index]}`} type="time" min={hour.opens_at} max={hour.closes_at} required={hour.enabled && !!hour.pause_ends_at} disabled={!hour.enabled} value={hour.pause_starts_at} onChange={(event) => changeHour(index, { pause_starts_at: event.target.value })} /></label>
              <label>Fin pause<input aria-label={`Fin pause ${weekDays[index]}`} type="time" min={hour.pause_starts_at || hour.opens_at} max={hour.closes_at} required={hour.enabled && !!hour.pause_starts_at} disabled={!hour.enabled} value={hour.pause_ends_at} onChange={(event) => changeHour(index, { pause_ends_at: event.target.value })} /></label>
            </div>
          ))}
        </div>
        <div className="review-buttons">
          <button type="submit" className="auth-submit">{saving ? "Enregistrement…" : "Enregistrer"}</button>
          <button type="button" className="admin-nav-link" onClick={editor.close}>Annuler</button>
        </div>
      </fieldset>
    </form>}
    </div>
  </section>;
}

function ClosureSettings({ csrfToken }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState(null);
  const [date, setDate] = useState(algerianDate());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    apiRequest(`professional-closures.php?page=${page}`, { signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, [page, refresh]);

  async function change(action, closureDate, closureReason = "") {
    setSaving(true);
    setNotice(null);
    try {
      const response = await apiRequest("professional-closures.php", {
        csrfToken, body: { action, date: closureDate, reason: closureReason },
      });
      setNotice({ kind: "success", text: response.message });
      setReason("");
      setPage(1);
      setRefresh((value) => value + 1);
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return (
    <section className="client-card">
      <h2>Fermetures exceptionnelles</h2>
      <p>Fermez une journée entière aux nouvelles réservations, jusqu’à un an à l’avance. Les horaires habituels restent inchangés.</p>
      <p className="field-hint">Une journée avec des rendez-vous confirmés ne peut pas être fermée. Gérez ces rendez-vous dans l’agenda avant d’ajouter la fermeture. Le motif reste privé.</p>
      {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); change("add", date, reason); }}>
        <fieldset className="form-fieldset" disabled={saving}>
          <label>Date de fermeture<input required type="date" min={algerianDate()} max={algerianDate(365)} value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Motif privé (facultatif)<input maxLength={180} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="submit" className="auth-submit">{saving ? "Enregistrement…" : "Fermer cette journée"}</button>
        </fieldset>
      </form>
      <h3>Fermetures à venir</h3>
      {!result && !notice && <p>Chargement…</p>}
      {result?.closures.length === 0 && <p>Aucune fermeture à venir.</p>}
      <div className="service-list">
        {result?.closures.map((closure) => <div className="service-row" key={closure.closure_date}>
          <span><strong>{closure.closure_date.split("-").reverse().join("/")}</strong>{closure.reason && <><br />{closure.reason}</>}</span>
          <button type="button" className="admin-nav-link" disabled={saving} onClick={() => {
            if (window.confirm("Supprimer cette fermeture et rétablir les horaires habituels ?")) change("remove", closure.closure_date);
          }}>Supprimer la fermeture</button>
        </div>)}
      </div>
      {result && <nav className="pagination" aria-label="Pages des fermetures">
        {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
        {result.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
      </nav>}
    </section>
  );
}
function SalonSettings({ configuration, csrfToken, onSaved, onNavigate }) {
  const [hours, setHours] = useState(() => weekDays.map((_, index) => {
    const row = configuration.hours.find((hour) => Number(hour.weekday) === index + 1);
    return {
      weekday: index + 1, enabled: !!row,
      opens_at: row?.opens_at.slice(0, 5) || "09:00",
      closes_at: row?.closes_at.slice(0, 5) || "18:00",
      pause_starts_at: row?.pause_starts_at?.slice(0, 5) || "",
      pause_ends_at: row?.pause_ends_at?.slice(0, 5) || "",
    };
  }));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  const [serviceStatus, setServiceStatus] = useState(null);
  const [serviceRetry, setServiceRetry] = useState(0);
  const hoursHeading = useRef(null);
  const salon = configuration.salon;
  const published = Number(salon.is_public) === 1;
  const [publish, setPublish] = useState(published);
  const activeCount = serviceStatus?.activeCount;
  const savedDays = configuration.hours.length;
  const canPublish = activeCount > 0 && savedDays > 0 && hours.some((hour) => hour.enabled);

  useEffect(() => {
    const controller = new AbortController();
    apiRequest("professional-services.php", { signal: controller.signal })
      .then(({ services }) => {
        if (!controller.signal.aborted) setServiceStatus({ activeCount: services.filter((service) => Number(service.is_active) === 1).length });
      })
      .catch((cause) => { if (!controller.signal.aborted) setServiceStatus({ error: cause.message }); });
    return () => controller.abort();
  }, [serviceRetry]);

  const changeHour = (index, changes) => setHours((current) => current.map((hour, i) => i === index ? { ...hour, ...changes } : hour));
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    if (!published && publish && !canPublish) {
      setNotice({ kind: "error", text: "Ajoutez une prestation active et enregistrez vos horaires avant de publier." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-salon.php", {
        csrfToken,
        body: { ...data, isPublic: publish, hours: hours.filter((hour) => hour.enabled).map(({ weekday, opens_at, closes_at, pause_starts_at, pause_ends_at }) => ({ weekday, opens_at, closes_at, pause_starts_at, pause_ends_at })) },
      });
      onSaved(result);
      setNotice({ kind: "success", text: publish !== published
        ? publish ? "Votre salon est publié dans l’annuaire BOOKILI." : "Votre salon a été retiré de l’annuaire BOOKILI."
        : "Votre salon et ses horaires ont été enregistrés." });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return (
    <section className="client-card salon-settings">
      <div className="salon-settings-heading">
        <h2>Mon salon et mes horaires</h2>
        <span className={`salon-publication-status${published ? " salon-publication-live" : ""}`}>{published ? "Salon publié" : "Salon non publié"}</span>
      </div>
      <p>{published ? "Votre salon apparaît dans l’annuaire BOOKILI." : "Votre salon n’apparaît pas encore dans l’annuaire BOOKILI."}</p>
      {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      <form className="auth-form" onSubmit={submit}>
        <fieldset disabled={saving} className="form-fieldset">
          <section className="salon-settings-card">
            <h3>Ouvrir la réservation en ligne</h3>
            <ol className="salon-publication-steps">
              <li>
                <span className="salon-step-marker" data-complete={activeCount > 0} aria-hidden="true">{activeCount > 0 ? "✓" : "1"}</span>
                <div><strong>Au moins une prestation active</strong>
                  {serviceStatus?.error ? <p role="alert">Impossible de vérifier les prestations : {serviceStatus.error}</p>
                    : activeCount == null ? <p role="status">Vérification des prestations…</p>
                    : <p>{activeCount > 0 ? `${activeCount} prestation(s) active(s)` : "Aucune prestation active."}</p>}
                </div>
                <div className="salon-step-actions">
                  {serviceStatus?.error && <button className="admin-nav-link" type="button" onClick={() => {
                    setServiceStatus(null);
                    setServiceRetry((value) => value + 1);
                  }}>Réessayer</button>}
                  <button className="admin-nav-link" type="button" onClick={() => onNavigate("services")}>Voir les prestations</button>
                </div>
              </li>
              <li>
                <span className="salon-step-marker" data-complete={savedDays > 0} aria-hidden="true">{savedDays > 0 ? "✓" : "2"}</span>
                <div><strong>Au moins un jour d’ouverture</strong><p>{savedDays ? `${savedDays} jour(s) d’ouverture enregistré(s)` : "Aucun horaire enregistré."}</p></div>
                <button className="admin-nav-link" type="button" onClick={() => hoursHeading.current?.focus()}>Définir les horaires</button>
              </li>
              <li>
                <span className="salon-step-marker" data-complete={published} aria-hidden="true">{published ? "✓" : "3"}</span>
                <div><strong>Publier le salon</strong>
                  <p>{published ? "Décochez puis enregistrez pour retirer votre salon de l’annuaire."
                    : canPublish ? "Cochez puis enregistrez pour ouvrir la réservation en ligne."
                    : "Disponible après l’ajout d’une prestation active et l’enregistrement des horaires."}</p>
                  <label className="checkbox-label"><input type="checkbox" name="isPublic" checked={publish} disabled={!published && !canPublish && !publish} onChange={(event) => setPublish(event.target.checked)} />Publier mon salon et ouvrir la réservation en ligne</label>
                </div>
              </li>
            </ol>
          </section>
          <section className="salon-settings-card">
          <h3 tabIndex={-1} ref={hoursHeading}>Horaires hebdomadaires</h3>
          <p className="field-hint">Une plage d’ouverture et une pause facultative par jour. Les deux horaires de pause doivent être à l’intérieur de l’ouverture. Les rendez-vous confirmés restent visibles après une modification.</p>
          <div className="hours-list">
            {hours.map((hour, index) => (
              <div className="hours-row" key={hour.weekday}>
                <label className="checkbox-label"><input type="checkbox" checked={hour.enabled} onChange={(event) => changeHour(index, { enabled: event.target.checked })} />{weekDays[index]}</label>
                {hour.enabled ? <>
                <label>Ouverture<input aria-label={`Ouverture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.opens_at} onChange={(event) => changeHour(index, { opens_at: event.target.value })} /></label>
                <label>Fermeture<input aria-label={`Fermeture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.closes_at} onChange={(event) => changeHour(index, { closes_at: event.target.value })} /></label>
                <label>Début pause<input aria-label={`Début pause ${weekDays[index]}`} type="time" min={hour.opens_at} max={hour.closes_at} required={hour.enabled && !!hour.pause_ends_at} disabled={!hour.enabled} value={hour.pause_starts_at} onChange={(event) => changeHour(index, { pause_starts_at: event.target.value })} /></label>
                <label>Fin pause<input aria-label={`Fin pause ${weekDays[index]}`} type="time" min={hour.pause_starts_at || hour.opens_at} max={hour.closes_at} required={hour.enabled && !!hour.pause_starts_at} disabled={!hour.enabled} value={hour.pause_ends_at} onChange={(event) => changeHour(index, { pause_ends_at: event.target.value })} /></label>
                </> : <span className="salon-hours-closed">Fermé</span>}
              </div>
            ))}
          </div>
          </section>
          <section className="salon-settings-card salon-settings-details">
          <h3>Coordonnées et message de réservation</h3>
          <label>Nom du salon<input name="name" required maxLength={180} defaultValue={salon.name} /></label>
          <div className="auth-grid">
            <label>Wilaya<select name="wilaya" required defaultValue={salon.wilaya_code}>{algerianWilayas.map((wilaya) => <option key={wilaya.code} value={wilaya.code}>{wilaya.name}</option>)}</select></label>
            <label>Ville ou commune<AlgerianCityInput name="city" required maxLength={120} defaultValue={salon.city} /></label>
          </div>
          <label>Adresse<input name="address" required maxLength={255} defaultValue={salon.address} /></label>
          <label>Téléphone<input name="phone" type="tel" required maxLength={24} defaultValue={salon.phone_number || ""} /></label>
          <label>Message pour vos clients<textarea name="bookingMessage" maxLength={1000} rows={4} defaultValue={salon.booking_message || ""} placeholder="Informations utiles à lire avant le rendez-vous" /></label>
          <p className="field-hint">Ce message sera affiché après le choix du créneau et ajouté aux e-mails de confirmation ou de modification.</p>
          </section>
          <div className="salon-save"><button type="submit" className="auth-submit">{saving ? "Enregistrement…" : publish && !published ? "Enregistrer et publier le salon" : "Enregistrer le salon"}</button></div>
        </fieldset>
      </form>
      <nav className="salon-settings-links" aria-label="Autres réglages du salon">
        <button className="admin-nav-link" type="button" onClick={() => onNavigate("profile")}>Descriptif établissement</button>
        <button className="admin-nav-link" type="button" onClick={() => onNavigate("photos")}>Gestion des photos</button>
      </nav>
    </section>
  );
}

const emptyService = { name: "", category: "coiffeur", duration: 30, price: 0, isActive: true };

function ServiceSettings({ csrfToken }) {
  const [services, setServices] = useState(null);
  const [editing, setEditing] = useState(emptyService);
  const editor = useSettingsEditor();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest("professional-services.php", { signal: controller.signal })
      .then((result) => setServices(result.services))
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, []);
  const groups = new Map(serviceCategories.map(([category, label]) => [category, { label, items: [] }]));
  for (const service of services ?? []) {
    if (!groups.has(service.category)) groups.set(service.category, { label: service.category, items: [] });
    groups.get(service.category).items.push(service);
  }
  function openEditor(event, service) {
    setEditing(service ? { id: service.id, name: service.name, category: service.category, duration: Number(service.duration_minutes), price: Number(service.price_dzd), isActive: Number(service.is_active) === 1 } : emptyService);
    setNotice(null);
    editor.start(event);
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-services.php", { csrfToken, body: editing });
      setServices(result.services);
      editor.close();
      setNotice({ kind: "success", text: "La prestation a été enregistrée. Les rendez-vous existants conservent leur prix et leur durée." });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return (
    <section className={`client-card pro-settings${editor.open ? " pro-settings-open" : ""}`}>
      <div className="pro-settings-header">
        <h2>Mes prestations</h2>
        {services && <button className="auth-submit" disabled={saving} type="button" onClick={(event) => openEditor(event)}>+ Ajouter une prestation</button>}
      </div>
      {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      {services === null && !notice && <p>Chargement…</p>}
      <div className="pro-settings-body">
      {services && <div className="pro-settings-list service-list">
        <h3>Catalogue</h3>
        {services.length === 0 && <p>Ajoutez votre première prestation.</p>}
        {[...groups].map(([category, { label, items }]) => items.length > 0 && <div key={category}>
          <h4 className="pro-settings-category">{label}</h4>
          {items.map((service) => <div className={`pro-settings-row${editor.open && editing.id === service.id ? " pro-settings-selected" : ""}`} key={service.id}>
            <span><strong>{service.name}</strong><br />{service.duration_minutes} min · {priceLabel(service.price_dzd)}</span>
            <SettingsStatus active={Number(service.is_active) === 1} activeText="En ligne" inactiveText="Masquée" />
            <button type="button" className="admin-nav-link" disabled={saving} aria-label={`Modifier ${service.name}`} onClick={(event) => openEditor(event, service)}>Modifier</button>
          </div>)}
        </div>)}
      </div>}
      {editor.open && <form className="auth-form pro-settings-editor" onSubmit={submit}>
        <div>
          <button className="pro-settings-back admin-nav-link" type="button" disabled={saving} onClick={editor.close}>← Retour aux prestations</button>
          <h3 ref={editor.heading} tabIndex={-1}>{editing.id ? "Modifier la prestation" : "Ajouter une prestation"}</h3>
        </div>
        <fieldset disabled={saving} className="form-fieldset">
          <label>Nom<input required maxLength={180} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Catégorie<select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })}>{serviceCategories.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <div className="auth-grid">
            <label>Durée (minutes)<input required type="number" min={15} max={480} step={15} value={editing.duration} onChange={(event) => setEditing({ ...editing, duration: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
            <label>Prix (DA)<input required type="number" min={0} max={10000000} step={1} value={editing.price} onChange={(event) => setEditing({ ...editing, price: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
          </div>
          <label className="checkbox-label"><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />Prestation disponible en ligne</label>
          {editing.id && <p className="pro-settings-note">Les rendez-vous déjà pris gardent leur tarif et leur durée.</p>}
          <div className="review-buttons">
            <button className="auth-submit" type="submit">{saving ? "Enregistrement…" : "Enregistrer la prestation"}</button>
            <button className="admin-nav-link" type="button" onClick={editor.close}>Annuler</button>
          </div>
        </fieldset>
      </form>}
      </div>
    </section>
  );
}
