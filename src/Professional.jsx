import { useEffect, useState } from "react";
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
          <nav aria-label={`Rubriques ${workspaceTabs.find(([value]) => value === tab)[1]}`}>
            {workspaceViews[tab].map(([value, label]) => (
              <button key={value} type="button" aria-current={view === value ? "page" : undefined} onClick={() => { setView(value); setMobileMenu(false); }}>{label}</button>
            ))}
          </nav>
          {view === "planning" && <>
            <AgendaCalendar key={agendaDate.slice(0, 7)} date={agendaDate} onChange={setAgendaDate} />
            <div className="agenda-sidebar-filters" ref={setAgendaFilters} />
          </>}
          {Number(configuration.salon.is_public)
            ? <Link className="pro-public-link" to={`/salons/${configuration.salon.id}`}>Voir ma page publique</Link>
            : <p className="pro-public-link">Salon non publié</p>}
          <InstallLink pro />
        </aside>}
        <main className="pro-panel">
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          {!configuration && !error && <p role="status">Chargement de votre espace…</p>}
          {configuration && <>
            <h1>{workspaceViews[tab].find(([value]) => value === view)[1]}</h1>
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
            {view === "salon" && <SalonSettings configuration={configuration} csrfToken={session.csrfToken} onSaved={setConfiguration} />}
            {view === "profile" && <ProfessionalProfile csrfToken={session.csrfToken} />}
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

function StaffSettings({ csrfToken, salonHours }) {
  const defaultHours = () => staffHoursForm(salonHours).map((hour) => ({ ...hour, pause_starts_at: "", pause_ends_at: "" }));
  const [staff, setStaff] = useState(null);
  const [editing, setEditing] = useState(() => ({ name: "", isActive: true, hours: defaultHours() }));
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
      setEditing({ name: "", isActive: true, hours: defaultHours() });
      setNotice({ kind: "success", text: result.message });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return <section className="client-card">
    <h2>Collaborateurs</h2>
    <p>Définissez les horaires et une pause facultative par jour pour chaque collaborateur. Les créneaux respecteront ses horaires, sa pause et ceux du salon. Les rendez-vous déjà pris restent visibles si un collaborateur est désactivé.</p>
    {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    {staff === null && <p>Chargement…</p>}
    <div className="service-list">{staff?.map((member) => <div className="service-row" key={member.id}>
      <span><strong>{member.name}</strong><br />{Number(member.is_active) ? "Actif et réservable" : "Inactif"}</span>
      <button type="button" className="admin-nav-link" disabled={saving} onClick={() => {
        setEditing({ staffId: Number(member.id), name: member.name, isActive: Number(member.is_active) === 1, hours: staffHoursForm(member.hours) });
      }}>Modifier</button>
    </div>)}</div>
    {staff !== null && <form className="auth-form" onSubmit={submit}>
      <h3>{editing.staffId ? "Modifier le collaborateur" : "Ajouter un collaborateur"}</h3>
      <fieldset className="form-fieldset" disabled={saving}>
        <label>Nom affiché<input required maxLength={120} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
        <label className="checkbox-label"><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />Collaborateur actif et réservable</label>
        <div className="hours-list">
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
          {editing.staffId && <button type="button" className="admin-nav-link" onClick={() => setEditing({ name: "", isActive: true, hours: defaultHours() })}>Annuler</button>}
        </div>
      </fieldset>
    </form>}
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
function SalonSettings({ configuration, csrfToken, onSaved }) {
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
  const salon = configuration.salon;
  const changeHour = (index, changes) => setHours((current) => current.map((hour, i) => i === index ? { ...hour, ...changes } : hour));
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-salon.php", {
        csrfToken,
        body: { ...data, isPublic: data.isPublic === "on", hours: hours.filter((hour) => hour.enabled).map(({ weekday, opens_at, closes_at, pause_starts_at, pause_ends_at }) => ({ weekday, opens_at, closes_at, pause_starts_at, pause_ends_at })) },
      });
      onSaved(result);
      setNotice({ kind: "success", text: "Votre salon et ses horaires ont été enregistrés." });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return (
    <section className="client-card">
      <h2>Mon salon et mes horaires</h2>
      <p className="field-hint">Une plage d’ouverture et une pause facultative par jour. Renseignez les deux horaires de pause, à l’intérieur de l’ouverture. Les rendez-vous confirmés restent visibles si vous changez vos horaires.</p>
      {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      <form className="auth-form" onSubmit={submit}>
        <fieldset disabled={saving} className="form-fieldset">
          <label>Nom du salon<input name="name" required maxLength={180} defaultValue={salon.name} /></label>
          <div className="auth-grid">
            <label>Wilaya<select name="wilaya" required defaultValue={salon.wilaya_code}>{algerianWilayas.map((wilaya) => <option key={wilaya.code} value={wilaya.code}>{wilaya.name}</option>)}</select></label>
            <label>Ville ou commune<AlgerianCityInput name="city" required maxLength={120} defaultValue={salon.city} /></label>
          </div>
          <label>Adresse<input name="address" required maxLength={255} defaultValue={salon.address} /></label>
          <label>Téléphone<input name="phone" type="tel" required maxLength={24} defaultValue={salon.phone_number || ""} /></label>
          <label>Message pour vos clients<textarea name="bookingMessage" maxLength={1000} rows={4} defaultValue={salon.booking_message || ""} placeholder="Informations utiles à lire avant le rendez-vous" /></label>
          <p className="field-hint">Ce message sera affiché après le choix du créneau et ajouté aux e-mails de confirmation ou de modification.</p>
          <div className="hours-list">
            {hours.map((hour, index) => (
              <div className="hours-row" key={hour.weekday}>
                <label className="checkbox-label"><input type="checkbox" checked={hour.enabled} onChange={(event) => changeHour(index, { enabled: event.target.checked })} />{weekDays[index]}</label>
                <label>Ouverture<input aria-label={`Ouverture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.opens_at} onChange={(event) => changeHour(index, { opens_at: event.target.value })} /></label>
                <label>Fermeture<input aria-label={`Fermeture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.closes_at} onChange={(event) => changeHour(index, { closes_at: event.target.value })} /></label>
                <label>Début pause<input aria-label={`Début pause ${weekDays[index]}`} type="time" min={hour.opens_at} max={hour.closes_at} required={hour.enabled && !!hour.pause_ends_at} disabled={!hour.enabled} value={hour.pause_starts_at} onChange={(event) => changeHour(index, { pause_starts_at: event.target.value })} /></label>
                <label>Fin pause<input aria-label={`Fin pause ${weekDays[index]}`} type="time" min={hour.pause_starts_at || hour.opens_at} max={hour.closes_at} required={hour.enabled && !!hour.pause_starts_at} disabled={!hour.enabled} value={hour.pause_ends_at} onChange={(event) => changeHour(index, { pause_ends_at: event.target.value })} /></label>
              </div>
            ))}
          </div>
          <label className="checkbox-label"><input type="checkbox" name="isPublic" defaultChecked={Number(salon.is_public) === 1} />Publier mon salon et ouvrir la réservation en ligne</label>
          <button type="submit" className="auth-submit">{saving ? "Enregistrement…" : "Enregistrer le salon"}</button>
        </fieldset>
      </form>
    </section>
  );
}

const emptyService = { name: "", category: "coiffeur", duration: 30, price: 0, isActive: true };

function ServiceSettings({ csrfToken }) {
  const [services, setServices] = useState(null);
  const [editing, setEditing] = useState(emptyService);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest("professional-services.php", { signal: controller.signal })
      .then((result) => setServices(result.services))
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, []);
  function edit(service) {
    setEditing({ id: service.id, name: service.name, category: service.category, duration: Number(service.duration_minutes), price: Number(service.price_dzd), isActive: Number(service.is_active) === 1 });
    setNotice(null);
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-services.php", { csrfToken, body: editing });
      setServices(result.services);
      setEditing(emptyService);
      setNotice({ kind: "success", text: "La prestation a été enregistrée. Les rendez-vous existants conservent leur prix et leur durée." });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return (
    <section className="client-card">
      <h2>Mes prestations</h2>
      {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      {services === null && !notice && <p>Chargement…</p>}
      {services?.length === 0 && <p>Ajoutez votre première prestation.</p>}
      <div className="service-list">
        {services?.map((service) => (
          <div className="service-row" key={service.id}>
            <span><strong>{service.name}</strong><br />{service.duration_minutes} min · {priceLabel(service.price_dzd)} · {Number(service.is_active) ? "Active" : "Masquée"}</span>
            <button type="button" className="admin-nav-link" disabled={saving} onClick={() => edit(service)}>Modifier</button>
          </div>
        ))}
      </div>
      {services !== null && <form className="auth-form" onSubmit={submit}>
        <h3>{editing.id ? "Modifier la prestation" : "Ajouter une prestation"}</h3>
        <fieldset disabled={saving} className="form-fieldset">
          <label>Nom<input required maxLength={180} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Catégorie<select value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })}>{serviceCategories.map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
          <div className="auth-grid">
            <label>Durée (minutes)<input required type="number" min={15} max={480} step={15} value={editing.duration} onChange={(event) => setEditing({ ...editing, duration: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
            <label>Prix (DA)<input required type="number" min={0} max={10000000} step={1} value={editing.price} onChange={(event) => setEditing({ ...editing, price: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
          </div>
          <label className="checkbox-label"><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />Prestation disponible en ligne</label>
          <div className="review-buttons">
            <button className="auth-submit" type="submit">{saving ? "Enregistrement…" : "Enregistrer la prestation"}</button>
            {editing.id && <button className="admin-nav-link" type="button" onClick={() => setEditing(emptyService)}>Annuler l’édition</button>}
          </div>
        </fieldset>
      </form>}
    </section>
  );
}
