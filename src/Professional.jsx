import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import ProfessionalAgenda from "./ProfessionalAgenda.jsx";
import AgendaCalendar from "./AgendaCalendar.jsx";
import CashRegister from "./CashRegister.jsx";
import { algerianDate, apiRequest, priceLabel, serviceCategories, weekDays } from "./api-client.js";
import { algerianWilayas } from "./data/algerian-wilayas.js";

const workspaceTabs = [["agenda", "Agenda"], ["caisse", "Caisse"], ["clients", "Clients"], ["admin", "Admin"]];
const workspaceViews = {
  agenda: [["planning", "Planning"], ["closures", "Fermetures exceptionnelles"]],
  caisse: [["cash", "Caisse et suivi des ventes"]],
  clients: [["directory", "Fichier clients"]],
  admin: [["services", "Prestations"], ["staff", "Collaborateurs"], ["salon", "Salon et horaires"]],
};

export default function ProfessionalSpace() {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [configuration, setConfiguration] = useState(null);
  const [tab, setTab] = useState("agenda");
  const [view, setView] = useState(workspaceViews.agenda[0][0]);
  const [agendaDate, setAgendaDate] = useState(algerianDate);
  const [agendaFilters, setAgendaFilters] = useState(null);
  const [error, setError] = useState("");

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
    <div className="pro-workspace">
      <header className="pro-topbar">
        <Link className="pro-salon-name" to="/" aria-label={`${configuration?.salon.name || "BOOKILI"} — Accueil BOOKILI`}>
          {configuration?.salon.name || "BOOKILI"}
        </Link>
        {configuration && <nav className="pro-tabs" aria-label="Espace professionnel">
          {workspaceTabs.map(([value, name]) => (
            <button key={value} type="button" aria-current={tab === value ? "page" : undefined} onClick={() => {
              if (value !== tab) {
                setTab(value);
                setView(workspaceViews[value][0][0]);
              }
            }}>{name}</button>
          ))}
        </nav>}
        <div className="pro-session">
          {session && <button type="button" onClick={logout}>Se déconnecter</button>}
        </div>
      </header>
      <div className="pro-layout">
        {configuration && <aside className="pro-sidebar">
          <nav aria-label={`Rubriques ${workspaceTabs.find(([value]) => value === tab)[1]}`}>
            {workspaceViews[tab].map(([value, label]) => (
              <button key={value} type="button" aria-current={view === value ? "page" : undefined} onClick={() => setView(value)}>{label}</button>
            ))}
          </nav>
          {view === "planning" && <>
            <AgendaCalendar key={agendaDate.slice(0, 7)} date={agendaDate} onChange={setAgendaDate} />
            <div className="agenda-sidebar-filters" ref={setAgendaFilters} />
          </>}
          {Number(configuration.salon.is_public)
            ? <Link className="pro-public-link" to={`/salons/${configuration.salon.id}`}>Voir ma page publique</Link>
            : <p className="pro-public-link">Salon non publié</p>}
        </aside>}
        <main className="pro-panel">
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          {!configuration && !error && <p role="status">Chargement de votre espace…</p>}
          {configuration && <>
            <h1>{workspaceViews[tab].find(([value]) => value === view)[1]}</h1>
            {view === "planning" && <ProfessionalAgenda csrfToken={session.csrfToken} date={agendaDate} setDate={setAgendaDate} filtersTarget={agendaFilters} />}
            {view === "closures" && <ClosureSettings csrfToken={session.csrfToken} />}
            {view === "cash" && <CashRegister csrfToken={session.csrfToken} />}
            {view === "directory" && <ProfessionalClients />}
            {view === "services" && <ServiceSettings csrfToken={session.csrfToken} />}
            {view === "staff" && <StaffSettings csrfToken={session.csrfToken} salonHours={configuration.hours} />}
            {view === "salon" && <SalonSettings configuration={configuration} csrfToken={session.csrfToken} onSaved={setConfiguration} />}
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
    };
  });
}

function StaffSettings({ csrfToken, salonHours }) {
  const [staff, setStaff] = useState(null);
  const [editing, setEditing] = useState(() => ({ name: "", isActive: true, hours: staffHoursForm(salonHours) }));
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
          hours: editing.hours.filter((hour) => hour.enabled).map(({ weekday, opens_at, closes_at }) => ({ weekday, opens_at, closes_at })),
        },
      });
      setStaff(result.staff);
      setEditing({ name: "", isActive: true, hours: staffHoursForm(salonHours) });
      setNotice({ kind: "success", text: result.message });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return <section className="client-card">
    <h2>Collaborateurs</h2>
    <p>Définissez les jours et plages propres à chaque collaborateur. Les créneaux proposés respecteront à la fois ses horaires et ceux du salon. Les rendez-vous déjà pris restent visibles si un collaborateur est désactivé.</p>
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
            </div>
          ))}
        </div>
        <div className="review-buttons">
          <button type="submit" className="auth-submit">{saving ? "Enregistrement…" : "Enregistrer"}</button>
          {editing.staffId && <button type="button" className="admin-nav-link" onClick={() => setEditing({ name: "", isActive: true, hours: staffHoursForm(salonHours) })}>Annuler</button>}
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
    return { weekday: index + 1, enabled: !!row, opens_at: row?.opens_at.slice(0, 5) || "09:00", closes_at: row?.closes_at.slice(0, 5) || "18:00" };
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
        body: { ...data, isPublic: data.isPublic === "on", hours: hours.filter((hour) => hour.enabled).map(({ weekday, opens_at, closes_at }) => ({ weekday, opens_at, closes_at })) },
      });
      onSaved(result);
      setNotice({ kind: "success", text: "Votre salon et ses horaires ont été enregistrés." });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }
  return (
    <section className="client-card">
      <h2>Mon salon et mes horaires</h2>
      <p className="field-hint">Une plage d’ouverture par jour, sans passage à minuit. Les rendez-vous déjà confirmés sont conservés si vous changez vos horaires.</p>
      {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      <form className="auth-form" onSubmit={submit}>
        <fieldset disabled={saving} className="form-fieldset">
          <label>Nom du salon<input name="name" required maxLength={180} defaultValue={salon.name} /></label>
          <div className="auth-grid">
            <label>Wilaya<select name="wilaya" required defaultValue={salon.wilaya_code}>{algerianWilayas.map((wilaya) => <option key={wilaya.code} value={wilaya.code}>{wilaya.name}</option>)}</select></label>
            <label>Ville ou commune<input name="city" required maxLength={120} defaultValue={salon.city} /></label>
          </div>
          <label>Adresse<input name="address" required maxLength={255} defaultValue={salon.address} /></label>
          <label>Téléphone<input name="phone" type="tel" required maxLength={24} defaultValue={salon.phone_number || ""} /></label>
          <div className="hours-list">
            {hours.map((hour, index) => (
              <div className="hours-row" key={hour.weekday}>
                <label className="checkbox-label"><input type="checkbox" checked={hour.enabled} onChange={(event) => changeHour(index, { enabled: event.target.checked })} />{weekDays[index]}</label>
                <label>Ouverture<input aria-label={`Ouverture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.opens_at} onChange={(event) => changeHour(index, { opens_at: event.target.value })} /></label>
                <label>Fermeture<input aria-label={`Fermeture ${weekDays[index]}`} type="time" required={hour.enabled} disabled={!hour.enabled} value={hour.closes_at} onChange={(event) => changeHour(index, { closes_at: event.target.value })} /></label>
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

function ProfessionalClients() {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    apiRequest(`professional-clients.php?page=${page}`, { signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [page]);
  return (
    <section className="client-card">
      <h2>Mes clients</h2>
      <p className="field-hint">Clients ayant au moins un rendez-vous non annulé dans votre établissement.</p>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {!result && !error && <p>Chargement…</p>}
      {result?.clients.length === 0 && <p>Aucun client pour le moment.</p>}
      <div className="service-list">
        {result?.clients.map((client, index) => (
          <article className="service-row" key={index}>
            <span><strong>{client.first_name} {client.last_name}</strong><br />{client.appointment_count} rendez-vous non annulé(s)</span>
            <a className="inline-link" href={`tel:${client.phone_number}`}>{client.phone_number}</a>
          </article>
        ))}
      </div>
      {result && <nav className="pagination" aria-label="Pages des clients">
        {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
        {result.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
      </nav>}
    </section>
  );
}
