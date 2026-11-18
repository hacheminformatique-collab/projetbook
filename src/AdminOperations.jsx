import { useEffect, useState } from "react";
import { apiRequest, apiUrl, algerianDate, priceLabel } from "./api-client.js";

function Feedback({ notice }) {
  if (!notice) return null;
  return <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>;
}

export function AdminAccounts({ csrfToken }) {
  const [filter, setFilter] = useState({ q: "", role: "all", status: "all" });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState(null);
  const [working, setWorking] = useState(false);
  const params = new URLSearchParams({ ...filter, page }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    apiRequest(`admin-accounts.php?${params}`, { signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, [params, refresh]);
  async function changeStatus(account, action) {
    const label = action === "suspend" ? "suspendre" : "réactiver";
    const reason = window.prompt(`Motif obligatoire pour ${label} ${account.email} :`);
    if (reason === null) return;
    if (!reason.trim()) { setNotice({ kind: "error", text: "Saisissez un motif pour cette action." }); return; }
    setWorking(true);
    setNotice(null);
    try {
      const response = await apiRequest("admin-accounts.php", { csrfToken, body: { action, accountId: account.id, reason: reason.trim() } });
      setNotice({ kind: "success", text: response.message });
      setRefresh((value) => value + 1);
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setWorking(false); }
  }
  return <section className="client-card">
    <h2>Comptes clients et professionnels</h2>
    <p>Les comptes sont suspendus plutôt que supprimés pour préserver l’historique des rendez-vous et des règlements. Les comptes d’administration et de l’équipe commerciale ne sont pas modifiables ici.</p>
    <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      setFilter({ q: fields.get("q").trim(), role: fields.get("role"), status: fields.get("status") });
      setPage(1);
    }}>
      <label>E-mail, nom ou salon<input name="q" maxLength={180} defaultValue={filter.q} /></label>
      <label>Type<select name="role" defaultValue={filter.role}><option value="all">Tous</option><option value="client">Clients</option><option value="professional">Professionnels</option></select></label>
      <label>Statut<select name="status" defaultValue={filter.status}><option value="all">Tous</option><option value="active">Actifs</option><option value="pending">En attente</option><option value="suspended">Suspendus</option></select></label>
      <button className="admin-nav-link" type="submit">Rechercher</button>
    </form>
    <Feedback notice={notice} />
    {!result && !notice && <p role="status">Chargement des comptes…</p>}
    {result?.accounts.length === 0 && <p>Aucun compte correspondant.</p>}
    <div className="service-list">
      {result?.accounts.map((account) => <article className="service-row" key={account.id}>
        <span><strong>{account.business_name || `${account.first_name || ""} ${account.last_name || ""}`.trim() || account.email}</strong><br />
          {account.email} · {account.role === "client" ? "Client" : "Professionnel"} · {account.status === "active" ? "Actif" : account.status === "pending" ? "En attente" : "Suspendu"}{account.subscription_status && ` · Abonnement : ${account.subscription_status}`}
        </span>
        <button className={account.status === "suspended" ? "auth-submit" : "admin-nav-link"} type="button" disabled={working || account.status === "pending"} onClick={() => changeStatus(account, account.status === "suspended" ? "restore" : "suspend")}>
          {account.status === "suspended" ? "Réactiver" : "Suspendre"}
        </button>
      </article>)}
    </div>
    <nav className="pagination" aria-label="Pages des comptes">
      {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
      {result?.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
    </nav>
  </section>;
}

function cycleDates(cycle) {
  const today = algerianDate();
  const start = cycle === "annual" ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`;
  const next = new Date(`${start}T12:00:00+01:00`);
  if (cycle === "annual") next.setUTCFullYear(next.getUTCFullYear() + 1);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(next.getUTCDate() - 1);
  return { start, end: next.toISOString().slice(0, 10) };
}

export function AdminBilling({ csrfToken }) {
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(null);
  const [plan, setPlan] = useState({ name: "", monthlyPrice: 0, annualPrice: 0, trialDays: 0, isActive: true });
  const [assignment, setAssignment] = useState({ accountId: "", planId: "", cycle: "monthly" });
  const [payment, setPayment] = useState({ subscriptionId: "", amountDzd: "", paymentMethod: "transfer", reference: "", ...cycleDates("monthly") });
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest("admin-billing.php", { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, [revision]);

  async function submit(action, payload) {
    setWorking(true);
    setNotice(null);
    try {
      const response = await apiRequest("admin-billing.php", { csrfToken, body: { action, ...payload } });
      setNotice({ kind: "success", text: response.message });
      setRevision((value) => value + 1);
      return true;
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
      return false;
    } finally { setWorking(false); }
  }
  const selectedPlan = result?.plans.find((item) => String(item.id) === assignment.planId);
  const expectedAmount = selectedPlan?.[assignment.cycle === "annual" ? "annual_price_dzd" : "monthly_price_dzd"] || "";
  const dates = cycleDates("monthly");
  return <>
    <section className="client-card">
      <h2>Forfaits professionnels</h2>
      <p>Définissez les tarifs et les essais. Aucun paiement en ligne ni prélèvement automatique n’est activé ; les règlements sont saisis après réception.</p>
      <Feedback notice={notice} />
      <form className="auth-form" onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(event.currentTarget);
        const saved = await submit("save-plan", {
          ...(plan.id ? { id: plan.id } : {}),
          ...Object.fromEntries(fields.entries()),
          monthlyPrice: Number(fields.get("monthlyPrice")),
          annualPrice: Number(fields.get("annualPrice")),
          trialDays: Number(fields.get("trialDays")),
          isActive: fields.get("isActive") === "on",
        });
        if (saved) {
          form.reset();
          setPlan({ name: "", monthlyPrice: 0, annualPrice: 0, trialDays: 0, isActive: true });
        }
      }}>
        <fieldset className="form-fieldset" disabled={working}>
          <label>Nom du forfait<input name="name" required maxLength={120} value={plan.name} onChange={(event) => setPlan({ ...plan, name: event.target.value })} /></label>
          <div className="auth-grid">
            <label>Prix mensuel (DA)<input name="monthlyPrice" type="number" min={0} max={100000000} required value={plan.monthlyPrice} onChange={(event) => setPlan({ ...plan, monthlyPrice: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
            <label>Prix annuel (DA)<input name="annualPrice" type="number" min={0} max={100000000} required value={plan.annualPrice} onChange={(event) => setPlan({ ...plan, annualPrice: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
          </div>
          <label>Essai gratuit (jours)<input name="trialDays" type="number" min={0} max={365} required value={plan.trialDays} onChange={(event) => setPlan({ ...plan, trialDays: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
          <label className="checkbox-label"><input name="isActive" type="checkbox" checked={plan.isActive} onChange={(event) => setPlan({ ...plan, isActive: event.target.checked })} />Forfait actif</label>
          <div className="review-buttons">
            <button className="auth-submit" type="submit">{plan.id ? "Mettre à jour le forfait" : "Créer le forfait"}</button>
            {plan.id && <button className="admin-nav-link" type="button" onClick={() => setPlan({ name: "", monthlyPrice: 0, annualPrice: 0, trialDays: 0, isActive: true })}>Annuler</button>}
          </div>
        </fieldset>
      </form>
      <div className="service-list">{result?.plans.map((item) => <div className="service-row" key={item.id}>
        <span><strong>{item.name}</strong><br />Mensuel : {priceLabel(item.monthly_price_dzd)} · Annuel : {priceLabel(item.annual_price_dzd)} · Essai : {item.trial_days} jours · {Number(item.is_active) ? "Actif" : "Inactif"}</span>
        <button className="admin-nav-link" type="button" disabled={working} onClick={() => setPlan({
          id: Number(item.id), name: item.name, monthlyPrice: Number(item.monthly_price_dzd),
          annualPrice: Number(item.annual_price_dzd), trialDays: Number(item.trial_days),
          isActive: Number(item.is_active) === 1,
        })}>Modifier</button>
      </div>)}</div>
    </section>
    <section className="client-card">
      <h2>Attribuer un forfait</h2>
      <form className="auth-form" onSubmit={(event) => {
        event.preventDefault();
        submit("assign", { ...assignment, accountId: Number(assignment.accountId), planId: Number(assignment.planId) });
      }}>
        <fieldset className="form-fieldset" disabled={working}>
          <label>Professionnel<select required value={assignment.accountId} onChange={(event) => setAssignment({ ...assignment, accountId: event.target.value })}><option value="">Choisir un compte</option>{result?.professionals.map((person) => <option key={person.id} value={person.id}>{person.display_name} · {person.email}</option>)}</select></label>
          <div className="auth-grid">
            <label>Forfait<select required value={assignment.planId} onChange={(event) => setAssignment({ ...assignment, planId: event.target.value })}><option value="">Choisir un forfait</option>{result?.plans.filter((item) => Number(item.is_active)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Cycle<select value={assignment.cycle} onChange={(event) => setAssignment({ ...assignment, cycle: event.target.value })}><option value="monthly">Mensuel</option><option value="annual">Annuel</option></select></label>
          </div>
          {selectedPlan && <p>Tarif du cycle sélectionné : {priceLabel(expectedAmount)}. Un essai éventuel est suivi d’un enregistrement manuel du règlement.</p>}
          <button className="auth-submit" type="submit" disabled={!assignment.accountId || !assignment.planId || Number(expectedAmount) < 1}>Attribuer</button>
        </fieldset>
      </form>
    </section>
    <section className="client-card">
      <h2>Abonnements et règlements reçus</h2>
      {!result && <p role="status">Chargement…</p>}
      <div className="service-list">{result?.subscriptions.map((sub) => <article className="service-row" key={sub.id}>
        <span><strong>{sub.salon_name || sub.display_name}</strong> · {sub.email}<br />{sub.plan_name} · {sub.billing_cycle === "annual" ? "Annuel" : "Mensuel"} · {priceLabel(sub.price_dzd)} · {sub.status} · Période {sub.period_start} au {sub.period_end}</span>
        <button className="admin-nav-link" type="button" disabled={working} onClick={() => {
          const cycle = sub.billing_cycle;
          const period = cycleDates(cycle);
          setPayment({ subscriptionId: String(sub.id), amountDzd: Number(sub.price_dzd), paymentMethod: "transfer", reference: "", ...period });
        }}>Enregistrer un règlement</button>
      </article>)}</div>
      <form className="auth-form" onSubmit={async (event) => {
        event.preventDefault();
        const payload = { ...payment, subscriptionId: Number(payment.subscriptionId), amountDzd: Number(payment.amountDzd) };
        const saved = await submit("record-payment", payload);
        if (saved) setPayment({ subscriptionId: "", amountDzd: "", paymentMethod: "transfer", reference: "", ...cycleDates("monthly") });
      }}>
        <fieldset className="form-fieldset" disabled={working || !payment.subscriptionId}>
          <label>Abonnement<select required value={payment.subscriptionId} onChange={(event) => setPayment({ ...payment, subscriptionId: event.target.value })}><option value="">Sélectionner un abonnement</option>{result?.subscriptions.map((sub) => <option key={sub.id} value={sub.id}>{sub.email} · {sub.plan_name}</option>)}</select></label>
          <div className="auth-grid">
            <label>Montant reçu (DA)<input type="number" min={1} step={1} required value={payment.amountDzd} onChange={(event) => setPayment({ ...payment, amountDzd: event.target.value === "" ? "" : Number(event.target.value) })} /></label>
            <label>Mode de règlement<select value={payment.paymentMethod} onChange={(event) => setPayment({ ...payment, paymentMethod: event.target.value })}><option value="transfer">Virement</option><option value="cash">Espèces</option><option value="card">Carte</option><option value="other">Autre</option></select></label>
          </div>
          <label>Référence du règlement<input required maxLength={120} value={payment.reference} onChange={(event) => setPayment({ ...payment, reference: event.target.value })} /></label>
          <div className="auth-grid">
            <label>Début de période<input type="date" required value={payment.periodStart} onChange={(event) => setPayment({ ...payment, periodStart: event.target.value })} /></label>
            <label>Fin de période<input type="date" required value={payment.periodEnd} onChange={(event) => setPayment({ ...payment, periodEnd: event.target.value })} /></label>
          </div>
          <p className="field-hint">Période mensuelle : premier à dernier jour du mois. Période annuelle : 1er janvier au 31 décembre.</p>
          <button className="auth-submit" type="submit">Confirmer le règlement reçu</button>
        </fieldset>
      </form>
      {result?.payments.map((item) => <p key={item.id}>{item.email} · {priceLabel(item.amount_dzd)} · {item.reference} · {item.period_start} → {item.period_end}</p>)}
    </section>
    <section className="client-card">
      <h2>Export comptable interne</h2>
      <p>Export CSV des ventes, annulations et règlements BOOKILI saisis. Ce document est un relevé interne, pas une facture réglementaire ni une déclaration fiscale.</p>
      <a className="admin-nav-link" href={apiUrl(`admin-accounting.php?from=${dates.start}&to=${algerianDate()}`)}>Exporter les opérations de ce mois</a>
    </section>
  </>;
}

export function AdminCampaigns({ csrfToken }) {
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(null);
  const [working, setWorking] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiRequest("admin-campaigns.php", { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, [revision]);
  async function submit(action, payload) {
    setWorking(true);
    setNotice(null);
    try {
      const response = await apiRequest("admin-campaigns.php", { csrfToken, body: { action, ...payload } });
      setNotice({ kind: "success", text: response.message });
      setRevision((value) => value + 1);
      return true;
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
      return false;
    } finally { setWorking(false); }
  }
  return <section className="client-card">
    <h2>Campagnes e-mail</h2>
    <p>Les campagnes sont envoyées uniquement aux comptes clients actifs ayant explicitement accepté les communications. Elles sont en texte brut, limitées à 5 000 destinataires et comportent un lien de désinscription. Configurez l’adresse publique HTTPS du site et le cron d’envoi avant de les lancer.</p>
    <p>Clients actuellement consentants : <strong>{result?.consentingClients ?? "…"}</strong></p>
    {notice && <Feedback notice={notice} />}
    <form className="auth-form" onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const fields = new FormData(form);
      const created = await submit("create", { subject: fields.get("subject"), body: fields.get("body") });
      if (created) form.reset();
    }}>
      <fieldset className="form-fieldset" disabled={working}>
        <label>Objet<input name="subject" required maxLength={200} /></label>
        <label>Message<textarea name="body" required maxLength={10000} rows={8} /></label>
        <button className="auth-submit" type="submit" disabled={working || !csrfToken}>{working ? "Mise en file…" : "Créer et mettre en file"}</button>
      </fieldset>
    </form>
    <h3>Historique des campagnes</h3>
    {!result && !notice && <p role="status">Chargement…</p>}
    {result?.campaigns.length === 0 && <p>Aucune campagne.</p>}
    <div className="service-list">{result?.campaigns.map((campaign) => <article className="service-row" key={campaign.id}>
      <span><strong>{campaign.subject}</strong><br />{campaign.status} · {campaign.sent}/{campaign.recipients} envoyés · {campaign.pending} en attente · {campaign.failed} en échec · {campaign.cancelled} annulés<br />Créée le {campaign.created_at}</span>
      {campaign.status === "queued" && <button className="admin-nav-link" type="button" disabled={working} onClick={() => {
        if (window.confirm("Annuler cette campagne avant le début de l’envoi ?")) submit("cancel", { campaignId: Number(campaign.id) });
      }}>Annuler</button>}
    </article>)}</div>
  </section>;
}
