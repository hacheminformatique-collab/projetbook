import { useEffect, useState } from "react";
import { algerianDate, apiRequest } from "./api-client.js";

function dayLabel(value) {
  return value.split("-").reverse().join("/");
}

export default function StaffAbsences({ csrfToken }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [staffId, setStaffId] = useState("");
  const [startDate, setStartDate] = useState(algerianDate());
  const [endDate, setEndDate] = useState(algerianDate());
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    apiRequest(`professional-staff-absences.php?page=${page}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setData(result);
        if (!staffId && result.staff.length) setStaffId(String(result.staff.find((member) => member.is_active)?.id || result.staff[0].id));
      })
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, [page, refresh]);

  async function change(action, absence) {
    setSaving(true);
    setNotice(null);
    try {
      const body = action === "add"
        ? { action, staffId: Number(staffId), startDate, endDate, reason }
        : { action, absenceId: absence.id };
      const result = await apiRequest("professional-staff-absences.php", { csrfToken, body });
      setNotice({ kind: "success", text: result.message });
      if (action === "add") {
        setReason("");
        setPage(1);
      }
      setRefresh((value) => value + 1);
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      setSaving(false);
    }
  }

  return <section className="client-card">
    <h2>Absences des collaborateurs</h2>
    <p>Enregistrez leurs absences sur une ou plusieurs journées. Les nouvelles réservations seront bloquées pour le collaborateur concerné ; les rendez-vous confirmés doivent être gérés dans l’agenda avant l’ajout.</p>
    <p className="field-hint">Les motifs restent privés. Une absence n’annule jamais un rendez-vous. La période peut aller jusqu’à un an à l’avance.</p>
    {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    {data && data.staff.length === 0 && <p>Aucun collaborateur. Ajoutez-en d’abord dans Admin → Collaborateurs.</p>}
    {data?.staff.length > 0 && <form className="auth-form staff-absence-form" onSubmit={(event) => {
      event.preventDefault();
      change("add");
    }}>
      <label>Collaborateur
        <select required value={staffId} disabled={saving} onChange={(event) => setStaffId(event.target.value)}>
          {data.staff.map((member) => <option key={member.id} value={member.id}>{member.name}{member.is_active ? "" : " (inactif)"}</option>)}
        </select>
      </label>
      <label>Du
        <input required type="date" min={algerianDate()} max={algerianDate(365)} value={startDate} disabled={saving} onChange={(event) => {
          setStartDate(event.target.value);
          if (endDate < event.target.value) setEndDate(event.target.value);
        }} />
      </label>
      <label>Au
        <input required type="date" min={startDate} max={algerianDate(365)} value={endDate} disabled={saving} onChange={(event) => setEndDate(event.target.value)} />
      </label>
      <label>Motif privé (facultatif)
        <input maxLength={180} value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} />
      </label>
      <button className="auth-submit" type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Ajouter l’absence"}</button>
    </form>}
    <h3>Absences à venir</h3>
    {!data && !notice && <p role="status">Chargement des absences…</p>}
    {data?.absences.length === 0 && <p>Aucune absence à venir.</p>}
    <div className="service-list">
      {data?.absences.map((absence) => <article className="service-row staff-absence-row" key={absence.id}>
        <span><strong>{absence.staff_name}</strong><br />{dayLabel(absence.start_date)}{absence.end_date !== absence.start_date && ` – ${dayLabel(absence.end_date)}`}{absence.reason && <><br /><span className="field-hint">{absence.reason}</span></>}</span>
        <button className="admin-nav-link" type="button" disabled={saving} onClick={() => {
          if (window.confirm(`Supprimer l’absence de ${absence.staff_name} ?`)) change("remove", absence);
        }}>Supprimer</button>
      </article>)}
    </div>
    {data && <nav className="pagination" aria-label="Pages des absences">
      {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
      {data.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
    </nav>}
  </section>;
}
