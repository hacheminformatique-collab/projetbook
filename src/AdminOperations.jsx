import { useEffect, useRef, useState } from "react";
import { apiRequest, apiUrl, algerianDate, appointmentDate, priceLabel } from "./api-client.js";

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

export function AdminProfileReviews({ csrfToken }) {
  const [result, setResult] = useState(null);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    apiRequest("admin-profile-reviews.php", { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, [refresh]);

  async function review(action, id) {
    setWorking(true);
    setNotice(null);
    try {
      const response = await apiRequest("admin-profile-reviews.php", { csrfToken, body: { action, id: Number(id) } });
      setNotice({ kind: "success", text: response.message });
      setRefresh((value) => value + 1);
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      setWorking(false);
    }
  }

  const categoryNames = { access: "Accès", training: "Formation", experience: "Expérience" };
  return <section className="client-card">
    <h2>Contenus en attente</h2>
    <Feedback notice={notice} />
    {!result && !notice && <p role="status">Chargement des contenus…</p>}
    {result && result.descriptions.length === 0 && result.entries.length === 0 && result.photos.length === 0 && <p>Aucun contenu à valider.</p>}
    {result?.descriptions.map((item) => <article className="service-row profile-review" key={`description-${item.id}`}>
      <span><strong>{item.name} · {item.city}</strong><br /><span className="booking-message">{item.profile_description}</span></span>
      <div className="review-buttons">
        <button className="admin-nav-link" type="button" disabled={working} onClick={() => review("reject-description", item.id)}>Refuser</button>
        <button className="auth-submit" type="button" disabled={working} onClick={() => review("approve-description", item.id)}>Valider</button>
      </div>
    </article>)}
    {result?.entries.map((item) => <article className="service-row profile-review" key={`entry-${item.id}`}>
      <span><strong>{item.salon_name} · {item.city}</strong><br />{categoryNames[item.category]} : {item.title}<br /><span className="booking-message">{item.details}</span></span>
      <div className="review-buttons">
        <button className="admin-nav-link" type="button" disabled={working} onClick={() => review("reject-entry", item.id)}>Refuser</button>
        <button className="auth-submit" type="button" disabled={working} onClick={() => review("approve-entry", item.id)}>Valider</button>
      </div>
    </article>)}
    {result?.photos.map((item) => <article className="service-row profile-review" key={`photo-${item.id}`}>
      <span className="profile-review-photo"><img src={apiUrl(`salon-photo.php?id=${encodeURIComponent(item.id)}`)} alt={`Photo proposée par ${item.salon_name}`} /><strong>{item.salon_name} · {item.city}</strong></span>
      <div className="review-buttons">
        <button className="admin-nav-link" type="button" disabled={working} onClick={() => review("reject-photo", item.id)}>Refuser</button>
        <button className="auth-submit" type="button" disabled={working} onClick={() => review("approve-photo", item.id)}>Valider</button>
      </div>
    </article>)}
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

function loadCampaignRecovery(accountId) {
  if (typeof accountId !== "string" || !/^[1-9][0-9]*$/.test(accountId)) {
    return { error: "Impossible d’identifier le compte administrateur. Rechargez la page après avoir mis à jour les fichiers du site." };
  }
  const key = `bookili:campaign-recovery:v1:${accountId}`;
  let saved;
  try {
    saved = window.sessionStorage.getItem(key);
  } catch {
    return { key, error: "Le stockage de cet onglet est inaccessible. Autorisez-le et rechargez la page avant de créer une campagne." };
  }
  if (saved === null) return { key };
  try {
    const record = JSON.parse(saved);
    const request = record?.request, preview = record?.preview;
    if (request?.action !== "create" || typeof request.requestKey !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(request.requestKey)
      || typeof request.subject !== "string" || !request.subject || request.subject.length > 200
      || typeof request.body !== "string" || !request.body || request.body.length > 10000
      || !Number.isInteger(request.expectedRecipients) || request.expectedRecipients < 1 || request.expectedRecipients > 5000
      || preview?.subject !== request.subject || preview?.body !== request.body
      || preview?.recipients !== request.expectedRecipients || typeof preview?.previewBody !== "string"
      || (record.resolution && (!["created", "changed"].includes(record.resolution.outcome) || typeof record.resolution.message !== "string"))) {
      throw new Error("Invalid campaign recovery");
    }
    return { key, request, preview, resolution: record.resolution || null };
  } catch {
    return { key, corrupt: true, error: "La demande de campagne enregistrée dans cet onglet est illisible. Vérifiez l’historique avant de l’effacer." };
  }
}

export function AdminCampaigns({ csrfToken, accountId }) {
  const [recovery] = useState(() => loadCampaignRecovery(accountId));
  const [result, setResult] = useState(null);
  const [draft, setDraft] = useState(() => recovery.request
    ? { subject: recovery.request.subject, body: recovery.request.body } : { subject: "", body: "" });
  const [preview, setPreview] = useState(recovery.preview || null);
  const [pending, setPending] = useState(recovery.request || null);
  const [storageProblem, setStorageProblem] = useState(recovery.error || "");
  const [cleanupOutcome, setCleanupOutcome] = useState(recovery.resolution || null);
  const creating = useRef(false);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState({ q: "", status: "all" });
  const [filterDraft, setFilterDraft] = useState({ q: "", status: "all" });
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState(() => recovery.resolution
    ? { kind: "error", text: `${recovery.resolution.message} La demande locale reste à effacer.` } : null);
  const [working, setWorking] = useState(false);
  const campaignParams = new URLSearchParams({ ...filter, page }).toString();
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    apiRequest(`admin-campaigns.php?${campaignParams}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, [campaignParams, revision]);
  async function submit(action, payload) {
    setWorking(true);
    setNotice(null);
    try {
      const response = await apiRequest("admin-campaigns.php", { csrfToken, body: { action, ...payload } });
      setNotice({ kind: "success", text: response.message });
      setPage(1);
      setRevision((value) => value + 1);
      return true;
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
      return false;
    } finally { setWorking(false); }
  }
  async function createCampaign() {
    if (creating.current || storageProblem || cleanupOutcome) return;
    creating.current = true;
    setWorking(true);
    setNotice(null);
    let request;
    try {
      request = pending || {
        action: "create", subject: preview.subject, body: preview.body,
        expectedRecipients: preview.recipients, requestKey: crypto.randomUUID(),
      };
    } catch {
      setNotice({ kind: "error", text: "Impossible de générer un identifiant sécurisé. Vérifiez que le site utilise HTTPS et un navigateur compatible." });
      creating.current = false;
      setWorking(false);
      return;
    }
    try {
      window.sessionStorage.setItem(recovery.key, JSON.stringify({ request, preview }));
      setPending(request);
    } catch {
      setNotice({ kind: "error", text: pending
        ? "Impossible de conserver la reprise dans cet onglet. Aucune nouvelle demande n’a été envoyée ; la campagne initiale peut déjà être enregistrée. Rétablissez le stockage et réessayez."
        : "Impossible de conserver la demande dans cet onglet. La campagne n’a pas été envoyée ; autorisez le stockage et réessayez." });
      creating.current = false;
      setWorking(false);
      return;
    }
    try {
      const response = await apiRequest("admin-campaigns.php", { csrfToken, body: request });
      finishCampaign("created", response.message, request);
      setPage(1);
      setRevision((value) => value + 1);
    } catch (cause) {
      if (cause.code === "campaign_audience_changed") {
        finishCampaign("changed", cause.message, request);
      } else {
        setNotice({ kind: "error", text: `${cause.message} Réessayez la même demande dans cet onglet.` });
      }
    } finally {
      creating.current = false;
      setWorking(false);
    }
  }
  function finishCampaign(outcome, message, request = pending) {
    try {
      window.sessionStorage.removeItem(recovery.key);
    } catch {
      const resolution = { outcome, message };
      let warning = "Rétablissez le stockage puis réessayez l’effacement.";
      try {
        window.sessionStorage.setItem(recovery.key, JSON.stringify({ request, preview, resolution }));
      } catch {
        warning = "Le résultat ne peut pas non plus être conservé : ne rechargez pas avant d’avoir rétabli le stockage et effacé la demande. Sinon, vérifiez l’historique avant de continuer.";
      }
      setCleanupOutcome(resolution);
      setNotice({ kind: "error", text: `${message} Impossible d’effacer la demande locale. ${warning}` });
      return;
    }
    setCleanupOutcome(null);
    setPending(null);
    setPreview(null);
    if (outcome === "created") setDraft({ subject: "", body: "" });
    setNotice({ kind: outcome === "created" ? "success" : "error", text: message });
  }
  function discardCorruptRecovery() {
    if (!window.confirm("Après vérification de l’historique, effacer la demande locale illisible ?")) return;
    try {
      window.sessionStorage.removeItem(recovery.key);
      setStorageProblem("");
    } catch {
      setStorageProblem("Impossible d’effacer la demande locale. Rétablissez le stockage et réessayez.");
    }
  }
  function abandonCampaignRecovery() {
    if (!window.confirm("Abandonner cette reprise ? La demande initiale peut encore être en cours ou déjà enregistrée. Vérifiez l’historique avant de recréer une campagne, au risque de provoquer un doublon.")) return;
    try {
      window.sessionStorage.removeItem(recovery.key);
      setPending(null);
      setPreview(null);
      setNotice({ kind: "error", text: "Reprise locale abandonnée. Vérifiez l’historique avant de recréer cette campagne." });
    } catch {
      setNotice({ kind: "error", text: "Impossible d’effacer la demande locale. Rétablissez le stockage et réessayez." });
    }
  }
  async function previewDraft(event) {
    event.preventDefault();
    setWorking(true);
    setNotice(null);
    setPreview(null);
    try {
      setPreview(await apiRequest("admin-campaigns.php", { csrfToken, body: { action: "preview", ...draft } }));
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally { setWorking(false); }
  }
  function changeDraft(event) {
    setDraft((current) => ({ ...current, [event.target.name]: event.target.value }));
    setPreview(null);
    setNotice(null);
  }
  const statuses = { queued: "En attente", sending: "En cours", completed: "Terminée", cancelled: "Annulée" };
  return <section className="client-card">
    <h2>Campagnes e-mail</h2>
    <p>Les campagnes sont envoyées uniquement aux comptes clients actifs ayant explicitement accepté les communications. Elles sont en texte brut, limitées à 5 000 destinataires et comportent un lien de désinscription. Configurez l’adresse publique HTTPS du site et le cron d’envoi avant de les lancer.</p>
    <p>Clients actuellement consentants : <strong>{result?.consentingClients ?? "…"}</strong></p>
    {storageProblem && <p className="form-message form-error" role="alert">{storageProblem}</p>}
    {storageProblem && recovery.corrupt && <button className="admin-nav-link" type="button" onClick={discardCorruptRecovery}>Effacer la demande locale illisible</button>}
    {notice && <Feedback notice={notice} />}
    <form className="auth-form" onSubmit={previewDraft}>
      <fieldset className="form-fieldset" disabled={working || !!storageProblem}>
        <label>Objet<input name="subject" required maxLength={200} value={draft.subject} onChange={changeDraft} disabled={!!pending} /></label>
        <label>Message<textarea name="body" required maxLength={10000} rows={8} value={draft.body} onChange={changeDraft} disabled={!!pending} /></label>
        <button className="admin-nav-link" type="submit" disabled={working || !csrfToken || !!pending}>Afficher l’aperçu</button>
        {preview && <section className="campaign-preview" aria-labelledby="campaign-preview-title" aria-live="polite">
          <h3 id="campaign-preview-title">Aperçu de la campagne</h3>
          <p>{pending ? "Destinataires lors de l’aperçu" : "Destinataires actuellement éligibles"} : <strong>{preview.recipients}</strong>. Le nombre est revérifié lors d’une nouvelle création ; le consentement est vérifié à nouveau avant chaque envoi.</p>
          {preview.recipients === 0 && <p className="form-message form-error">Aucun client actif n’a accepté les communications marketing.</p>}
          {preview.recipients > 5000 && <p className="form-message form-error">Une campagne est limitée à 5 000 destinataires consentants.</p>}
          <p><strong>Objet :</strong> {preview.subject}</p>
          <pre>{preview.previewBody}</pre>
          <p className="field-hint">Le lien indiqué est un exemple : chaque destinataire recevra son propre lien de désinscription. La mise en file ne garantit pas la réception.</p>
          {pending && !cleanupOutcome && <p className="field-hint">La réponse est incertaine. Réessayez cette même demande : elle ne créera pas de doublon. Elle est conservée dans cet onglet, même après rechargement, mais peut disparaître à sa fermeture.</p>}
          {cleanupOutcome ? <button className="auth-submit" type="button" onClick={() => finishCampaign(cleanupOutcome.outcome, cleanupOutcome.message)}>Réessayer l’effacement local</button>
            : <button className="auth-submit" type="button" disabled={working || !csrfToken || preview.recipients < 1 || preview.recipients > 5000} onClick={createCampaign}>{pending ? "Réessayer la même demande" : "Confirmer la mise en file"}</button>}
          {pending && !cleanupOutcome && <button className="admin-nav-link" type="button" onClick={abandonCampaignRecovery}>Abandonner la reprise</button>}
        </section>}
      </fieldset>
    </form>
    <h3>Historique des campagnes</h3>
    <p>Les envois acceptés par le serveur ne garantissent pas la réception. Le cron traite les reprises possibles ; une reprise vérifie à nouveau le consentement et ne renvoie pas les messages déjà acceptés.</p>
    <form className="booking-toolbar" aria-label="Filtrer l’historique des campagnes" onSubmit={(event) => {
      event.preventDefault();
      setFilter({ ...filterDraft, q: filterDraft.q.trim() });
      setPage(1);
      setNotice(null);
      setRevision((value) => value + 1);
    }}>
      <label>Rechercher dans l’objet<input name="q" maxLength={200} value={filterDraft.q} onChange={(event) => setFilterDraft((current) => ({ ...current, q: event.target.value }))} /></label>
      <label>Statut<select name="status" value={filterDraft.status} onChange={(event) => setFilterDraft((current) => ({ ...current, status: event.target.value }))}>
        <option value="all">Tous les statuts</option><option value="queued">En attente</option><option value="sending">En cours</option>
        <option value="completed">Terminée</option><option value="cancelled">Annulée</option>
      </select></label>
      <button className="admin-nav-link" type="submit" disabled={working}>Filtrer</button>
      <button className="admin-nav-link" type="button" disabled={working} onClick={() => {
        setFilterDraft({ q: "", status: "all" });
        setFilter({ q: "", status: "all" });
        setPage(1);
        setNotice(null);
        setRevision((value) => value + 1);
      }}>Effacer les filtres</button>
    </form>
    {(filter.q || filter.status !== "all") && <p className="field-hint">L’historique est filtré : certaines campagnes peuvent être masquées.</p>}
    <button className="admin-nav-link" type="button" disabled={working} onClick={() => { setNotice(null); setRevision((value) => value + 1); }}>Actualiser les campagnes</button>
    {!result && !notice && <p role="status">Chargement…</p>}
    {result?.campaigns.length === 0 && <p>Aucune campagne ne correspond aux filtres sur cette page.</p>}
    <div className="service-list">{result?.campaigns.map((campaign) => <article className="service-row" key={campaign.id}>
      <span><strong>{campaign.subject}</strong><br />{statuses[campaign.status]} · {campaign.sent}/{campaign.recipients} envois acceptés · {campaign.pending} en attente, dont {campaign.retrying} en reprise · {campaign.failed} en échec définitif · {campaign.cancelled} annulés<br />
        Créée le {appointmentDate(campaign.created_at)} (heure d’Algérie)
        {campaign.completed_at && <><br />Terminée le {appointmentDate(campaign.completed_at)} (heure d’Algérie)</>}
        {campaign.next_retry && <><br />Reprise possible à partir de {appointmentDate(campaign.next_retry)} (heure d’Algérie)</>}
      </span>
      <div className="review-buttons">
      {campaign.status === "queued" && <button className="admin-nav-link" type="button" disabled={working} onClick={() => {
        if (window.confirm("Annuler cette campagne avant le début de l’envoi ?")) submit("cancel", { campaignId: Number(campaign.id) });
      }}>Annuler</button>}
      {campaign.status !== "cancelled" && Number(campaign.failed) > 0 && <button className="admin-nav-link" type="button" disabled={working} onClick={() => {
        if (window.confirm("Remettre en attente les e-mails en échec de cette campagne ? Le consentement sera vérifié avant l’envoi.")) submit("retry-failed", { campaignId: Number(campaign.id) });
      }}>Réessayer les échecs</button>}
      </div>
    </article>)}</div>
    <nav className="pagination" aria-label="Pages des campagnes">
      {page > 1 && <button className="admin-nav-link" type="button" disabled={working} onClick={() => { setNotice(null); setPage(page - 1); }}>Précédent</button>}
      {result?.hasMore && <button className="admin-nav-link" type="button" disabled={working} onClick={() => { setNotice(null); setPage(page + 1); }}>Suivant</button>}
    </nav>
  </section>;
}
