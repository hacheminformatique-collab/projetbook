import { useEffect, useRef, useState } from "react";
import { algerianDate, apiRequest, apiUrl, appointmentDate, priceLabel } from "./api-client.js";
import Inventory from "./Inventory.jsx";

const endpoint = "professional-cash.php";
const methods = { cash: "Espèces", card: "Carte", transfer: "Virement", other: "Autre", gift_card: "Carte cadeau" };

function useCashData(query, revision = 0, api = endpoint) {
  const [response, setResponse] = useState(null);
  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    apiRequest(`${api}?${query}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResponse({ query, revision, data }); })
      .catch((cause) => {
        if (!controller.signal.aborted) setResponse((last) => ({ query, revision, error: cause.message, previousData: last?.data ?? last?.previousData }));
      });
    return () => controller.abort();
  }, [api, query, revision]);
  return response?.query === query && response.revision === revision ? response : { previousData: response?.data ?? response?.previousData };
}

function Feedback({ notice }) {
  if (!notice) return null;
  return <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>;
}

export default function CashRegister({ csrfToken, appointment = null, initialSaleId = null, onAppointmentHandled }) {
  const [view, setView] = useState(initialSaleId !== null ? "journal" : "sale");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saleId, setSaleId] = useState(initialSaleId);
  const [recorded, setRecorded] = useState(null);
  const [activeTicket, setActiveTicket] = useState(null);
  const [mobileMenu, setMobileMenu] = useState(!appointment && initialSaleId === null);
  const refresh = () => setRevision((value) => value + 1);
  function canOpen(value) {
    return !(busy && view !== value) && !(appointment && value === "tickets");
  }
  function open(value) {
    if (value !== "journal") setRecorded(null);
    setView(value);
  }
  const mobileGroups = [
    ["Encaissement", [["sale", "Nouveau ticket"], ["tickets", "Tickets en attente"]]],
    ["Transactions", [["journal", "Journal de caisse"], ["payments", "Règlements"], ["drawer", "Fond de caisse"], ["gift-cards", "Cartes cadeaux en salon"]]],
    ["Rapports", [["reports", "Rapports de caisse"]]],
    ["Gestion des stocks", [["inventory", "État des stocks"]]],
  ];
  return <>
    <nav className="workspace-tabs cash-desktop-nav" aria-label="Caisse professionnelle">
      {[["sale", "Vente"], ["tickets", "Tickets en attente"], ["overview", "Synthèse"], ["gift-cards", "Cartes cadeaux"], ["journal", "Journal"], ["payments", "Règlements"], ["drawer", "Fond de caisse"], ["reports", "Rapports"], ["inventory", "Stocks"]].map(([value, name]) =>
        <button key={value} type="button" disabled={!canOpen(value)} aria-current={view === value ? "page" : undefined} onClick={() => open(value)}>{name}</button>
      )}
    </nav>
    <details className="cash-mobile-nav" open={mobileMenu} onToggle={(event) => setMobileMenu(event.currentTarget.open)}>
      <summary>Menu de caisse</summary>
      <nav aria-label="Rubriques de caisse">
        {mobileGroups.map(([name, links]) => <section className="cash-menu-group" key={name}>
          <h2>{name}</h2>
          {links.map(([value, label]) => <button key={value} type="button" disabled={!canOpen(value)} aria-current={view === value ? "page" : undefined} onClick={(event) => {
            event.currentTarget.closest("details").querySelector("summary").focus();
            setMobileMenu(false);
            open(value);
          }}>{label}</button>)}
        </section>)}
        <section className="cash-menu-group">
          <h2>Paiements à venir</h2>
          <p>Tap to Pay sur iPhone (bientôt disponible)</p>
          <p>Terminal de paiement (bientôt disponible)</p>
          <p>Paiement en ligne (bientôt disponible)</p>
          <p>Achat public de cartes cadeaux (bientôt disponible)</p>
        </section>
      </nav>
    </details>
    <div hidden={view !== "sale"}>
      <SaleForm key={`${appointment?.id || "regular"}:${activeTicket?.id || "new"}:${activeTicket?.revision || 0}`} csrfToken={csrfToken} revision={revision} appointment={appointment} ticket={activeTicket} onBusy={setBusy} onTicketSaved={refresh} onRecorded={(result) => {
        setSaleId(result.saleId);
        setRecorded(result);
        setActiveTicket(null);
        refresh();
        setView("journal");
        if (appointment) onAppointmentHandled?.();
      }} />
    </div>
    {view === "tickets" && !appointment && <PendingTickets csrfToken={csrfToken} revision={revision} onBusy={setBusy} onChanged={refresh} onResume={(ticket) => {
      setActiveTicket(ticket);
      setView("sale");
    }} />}
    {view === "overview" && <CashOverview revision={revision} />}
    {view === "gift-cards" && <GiftCards csrfToken={csrfToken} onBusy={setBusy} onRecorded={refresh} />}
    {view === "journal" && <Journal csrfToken={csrfToken} saleId={saleId} recorded={recorded} onSelect={setSaleId} revision={revision} onChanged={refresh} onBusy={setBusy} busy={busy} />}
    {view === "payments" && <Payments revision={revision} onSelect={(id) => { setSaleId(id); open("journal"); }} />}
    {view === "drawer" && <CashDrawer csrfToken={csrfToken} onBusy={setBusy} />}
    {view === "reports" && <CashReports revision={revision} onSelect={(id) => { setSaleId(id); open("journal"); }} />}
    {view === "inventory" && <Inventory csrfToken={csrfToken} />}
  </>;
}

function PendingTickets({ csrfToken, revision, onBusy, onChanged, onResume }) {
  const { data, error } = useCashData("view=tickets", revision);
  const [busyTicket, setBusyTicket] = useState(null);
  const [notice, setNotice] = useState(null);

  async function resume(ticketId) {
    setBusyTicket(ticketId);
    onBusy(true);
    setNotice(null);
    try {
      const ticket = await apiRequest(`${endpoint}?view=ticket&ticketId=${encodeURIComponent(ticketId)}`);
      onResume(ticket);
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
      onChanged();
    } finally {
      setBusyTicket(null);
      onBusy(false);
    }
  }

  async function cancel(ticket) {
    if (!window.confirm(`Abandonner le ticket n° ${ticket.id} ?`)) return;
    setBusyTicket(ticket.id);
    onBusy(true);
    setNotice(null);
    try {
      await apiRequest(endpoint, {
        csrfToken,
        body: { action: "cancel_ticket", ticketId: ticket.id, expectedRevision: ticket.revision },
      });
      setNotice({ kind: "success", text: `Ticket n° ${ticket.id} abandonné.` });
      onChanged();
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
      onChanged();
    } finally {
      setBusyTicket(null);
      onBusy(false);
    }
  }

  return <section className="client-card">
    <h2>Tickets en attente</h2>
    <p>Les tickets sont enregistrés pour être repris ultérieurement. Le stock n’est ajusté qu’au moment de l’encaissement.</p>
    <Feedback notice={notice} />
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!data && !error && <p role="status">Chargement des tickets…</p>}
    {data?.tickets.length === 0 && <p>Aucun ticket en attente.</p>}
    <div className="service-list">
      {data?.tickets.map((ticket) => <article className="service-row" key={ticket.id}>
        <span><strong>Ticket n° {ticket.id}</strong> · {ticket.line_count} article(s) · {priceLabel(ticket.total_dzd)}<br />
          Mis à jour le {appointmentDate(ticket.updated_at)}
        </span>
        <div className="cash-ticket-actions">
          <button className="admin-nav-link" type="button" disabled={busyTicket !== null} onClick={() => resume(ticket.id)}>{busyTicket === ticket.id ? "Chargement…" : "Reprendre"}</button>
          <button className="admin-nav-link" type="button" disabled={busyTicket !== null} onClick={() => cancel(ticket)}>Abandonner</button>
        </div>
      </article>)}
    </div>
  </section>;
}

function currentCashPeriod(unit) {
  const today = algerianDate();
  let from = today;
  if (unit === "week") {
    const monday = new Date(`${today}T12:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    from = monday.toISOString().slice(0, 10);
  } else if (unit === "month") from = `${today.slice(0, 7)}-01`;
  else if (unit === "year") from = `${today.slice(0, 4)}-01-01`;
  return { from, to: today };
}

export function CashOverview({ revision = 0, statistics = false }) {
  const [dates, setDates] = useState(() => currentCashPeriod(statistics ? "month" : "day"));
  const [period, setPeriod] = useState(dates);
  const [staff, setStaff] = useState("all");
  const filters = statistics ? { ...period, staff } : period;
  const query = new URLSearchParams({ view: statistics ? "statistics" : "overview", ...filters }).toString();
  const { data, error, previousData } = useCashData(query, revision);
  const team = (data ?? previousData)?.staff ?? [];
  const maximum = Math.max(1, ...(data?.days || []).map((day) => Math.abs(day.net_dzd)));
  const percent = (value) => value == null ? "—" : `${value.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;
  return <section className="client-card cash-overview">
    <header className="cash-overview-header">
      <div><h2>{statistics ? "Statistiques" : "Synthèse de caisse"}</h2><p>Ventes, annulations et règlements enregistrés pour la période choisie.</p></div>
      <button className="admin-nav-link" type="button" onClick={() => window.print()}>Imprimer</button>
    </header>
    {statistics && <div className="booking-toolbar" role="group" aria-label="Période en cours">
      {[["day", "Jour"], ["week", "Semaine"], ["month", "Mois"], ["year", "Année"]].map(([unit, label]) => (
        <button className="admin-nav-link" key={unit} type="button" onClick={() => {
          const next = currentCashPeriod(unit);
          setDates(next);
          setPeriod(next);
        }}>{label}</button>
      ))}
    </div>}
    <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      setPeriod({ from: fields.get("from"), to: fields.get("to") });
    }}>
      <label>Du<input name="from" type="date" required max={algerianDate()} value={dates.from} onChange={(event) => setDates({ ...dates, from: event.target.value })} /></label>
      <label>Au<input name="to" type="date" required max={algerianDate()} value={dates.to} onChange={(event) => setDates({ ...dates, to: event.target.value })} /></label>
      <button className="admin-nav-link" type="submit">Afficher la période</button>
    </form>
    {statistics && <div className="booking-toolbar">
      <label>Équipe<select value={staff} onChange={(event) => setStaff(event.target.value)}>
        <option value="all">Toute l’équipe</option>
        <option value="unassigned">Non attribué</option>
        {team.map((member) => <option key={member.id} value={member.id}>{member.name}{Number(member.is_active) ? "" : " (inactif)"}</option>)}
      </select></label>
      <p className="field-hint">Les ventes sont rattachées au collaborateur du rendez-vous. Une vente sans rendez-vous ou sans collaborateur est non attribuée.</p>
    </div>}
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!data && !error && <p role="status">Calcul de la synthèse…</p>}
    {data && <>
      <div className="cash-kpis">
        <article><span>Ventes brutes</span><strong>{priceLabel(data.summary.gross_dzd)}</strong><small>{data.summary.sale_count} vente(s)</small></article>
        <article><span>Annulations</span><strong>{priceLabel(data.summary.void_dzd)}</strong><small>{data.summary.void_count} annulation(s)</small></article>
        <article><span>Net sur la période</span><strong>{priceLabel(data.summary.net_dzd)}</strong><small>Ventes moins annulations</small></article>
        <article><span>Règlements encaissés</span><strong>{priceLabel(data.summary.received_dzd)}</strong><small>Espèces, carte, virement et autres</small></article>
        <article><span>Cartes cadeaux utilisées</span><strong>{priceLabel(data.summary.gift_card_dzd)}</strong><small>Montant consommé sur les ventes</small></article>
        {statistics && <article><span>Panier moyen brut</span><strong>{data.average_basket_dzd === null ? "—" : priceLabel(data.average_basket_dzd)}</strong><small>Ventes brutes divisées par le nombre de ventes, avant annulations</small></article>}
      </div>
      {statistics && <section className="cash-report-section">
        <h3>Rendez-vous et retour des clients</h3>
        <div className="cash-kpis">
          <article><span>Taux de non-présentation</span><strong>{percent(data.no_show_rate)}</strong>
            <small>{data.no_show_count} marqué(s) « Non présenté » sur {data.ended_count} rendez-vous terminés et non annulés. Un rendez-vous non marqué ne prouve pas une présence.</small></article>
          <article><span>Taux de retour des clients</span><strong>{percent(data.returns.rate)}</strong>
            <small>{data.returns.returning_count} sur {data.returns.client_count} clients distincts. Seuls les rendez-vous terminés avec une vente non annulée comptent. Le rendez-vous précédent peut être en dehors de la période ou avec un autre collaborateur du salon.</small></article>
        </div>
      </section>}
      {statistics && <section className="cash-report-section">
        <h3>Ventes nettes par catégorie</h3>
        <p className="field-hint">Les annulations sont déduites à la date de leur enregistrement. Les cartes cadeaux émises sont comptées dans « Divers ».</p>
        <div className="cash-kpis">
          <article><span>Prestations</span><strong>{priceLabel(data.breakdown.services_dzd)}</strong></article>
          <article><span>Produits</span><strong>{priceLabel(data.breakdown.products_dzd)}</strong></article>
          <article><span>Divers</span><strong>{priceLabel(data.breakdown.other_dzd)}</strong></article>
        </div>
      </section>}
      <section className="cash-report-section">
        <h3>Répartition des règlements</h3>
        {data.payments.length === 0 ? <p>Aucun règlement enregistré sur cette période.</p> :
          <div className="cash-report-table"><table>
            <thead><tr><th>Mode de règlement</th><th>Net des ventes</th><th>Montant encaissé</th><th>Carte cadeau</th><th>Ventes</th></tr></thead>
            <tbody>{data.payments.map((row) => <tr key={row.payment_method}>
              <th scope="row">{methods[row.payment_method] || row.payment_method}</th>
              <td>{priceLabel(row.net_dzd)}</td><td>{priceLabel(row.received_dzd)}</td>
              <td>{priceLabel(row.gift_card_dzd)}</td><td>{row.sale_count}</td>
            </tr>)}</tbody>
          </table></div>}
      </section>
      <section className="cash-report-section">
        <h3>Activité par jour</h3>
        <p className="field-hint">Les rendez-vous comptent ici s’ils sont confirmés et que leur créneau est passé ; l’application ne suit pas encore la présence effective.</p>
        {data.days.length === 0 ? <p>Aucune vente ni aucun rendez-vous sur cette période.</p> :
          <div className="cash-report-days">{data.days.map((day) => <article key={day.day}>
            <div className="cash-report-day-heading"><strong>{day.day.split("-").reverse().join("/")}</strong><span>{day.visit_count} RDV · {day.sale_count} vente(s) · {day.void_count} annulation(s)</span><b>{priceLabel(day.net_dzd)}</b></div>
            <div className="cash-report-bar" role="img" aria-label={`Net ${priceLabel(day.net_dzd)}`}>
              <span className={day.net_dzd < 0 ? "cash-report-negative" : ""} style={{ width: `${Math.max(1, Math.abs(day.net_dzd) / maximum * 100)}%` }} />
            </div>
          </article>)}</div>}
      </section>
      {statistics && <a className="admin-nav-link cash-stats-export" href={apiUrl(`${endpoint}?${new URLSearchParams({ ...filters, view: "statistics-csv" })}`)}>
        Exporter les statistiques (CSV)
      </a>}
    </>}
  </section>;
}

function SaleForm({ csrfToken, revision, appointment, ticket, onBusy, onTicketSaved, onRecorded }) {
  const [kind, setKind] = useState("product");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState(() => ticket
    ? ticket.lines.map((item) => ({
      kind: item.item_kind, id: Number(item.item_id), name: item.item_name,
      quantity: Number(item.quantity), expectedPrice: Number(item.unit_price_dzd),
    }))
    : appointment?.services.map((item) => ({
      kind: "service", id: Number(item.id), name: item.name, quantity: 1, expectedPrice: Number(item.price_dzd),
    })) || []);
  const [savedTicket, setSavedTicket] = useState(ticket ? { id: Number(ticket.id), revision: Number(ticket.revision) } : null);
  const [paymentMethod, setPayment] = useState("cash");
  const [giftCardCode, setGiftCardCode] = useState("");
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
  const [ticketRequest, setTicketRequest] = useState(null);
  const [saving, setSaving] = useState(false);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const active = useRef(false);
  const { data: catalog, error } = useCashData(appointment ? "" : new URLSearchParams({ view: "catalog", q: search, kind }).toString(), `${revision}:${catalogRefresh}`);

  function add(item) {
    if (cart.length >= 20 || cart.some((line) => line.kind === kind && String(line.id) === String(item.id))) return;
    setCart([...cart, { kind, id: item.id, name: item.name, quantity: 1, expectedPrice: Number(item.price_dzd) }]);
  }
  async function submit(event) {
    event.preventDefault();
    if (active.current || cart.length === 0) return;
    active.current = true;
    setSaving(true);
    onBusy(true);
    setNotice(null);
    try {
      const body = pending || {
        action: "record", requestKey: crypto.randomUUID(), paymentMethod,
        ...(appointment ? { appointmentId: Number(appointment.id) } : {}),
        ...(savedTicket ? { ticketId: savedTicket.id, ticketRevision: savedTicket.revision } : {}),
        ...(giftCardCode.trim() ? { giftCardCode: giftCardCode.trim().replaceAll(" ", "").toUpperCase() } : {}),
        lines: cart.map(({ name: _name, ...line }) => line),
      };
      setPending(body);
      const result = await apiRequest(endpoint, { csrfToken, body });
      setCart([]);
      setPending(null);
      onRecorded(result);
      setGiftCardCode("");
    } catch (cause) {
      if (cause.status >= 400 && cause.status < 500) setPending(null);
      setNotice({ kind: "error", text: cause.message });
    } finally {
      active.current = false;
      setSaving(false);
      onBusy(false);
    }
  }
  async function saveTicket() {
    if (active.current || cart.length === 0 || appointment) return;
    active.current = true;
    setSaving(true);
    onBusy(true);
    setNotice(null);
    try {
      const body = ticketRequest || {
        action: savedTicket ? "update_ticket" : "save_ticket",
        requestKey: crypto.randomUUID(),
        ...(savedTicket ? { ticketId: savedTicket.id, expectedRevision: savedTicket.revision } : {}),
        lines: cart.map(({ name: _name, ...line }) => line),
      };
      setTicketRequest(body);
      const result = await apiRequest(endpoint, { csrfToken, body });
      setSavedTicket({ id: result.ticketId, revision: result.revision });
      setTicketRequest(null);
      onTicketSaved();
      setNotice({ kind: "success", text: "Ticket enregistré en attente. Il pourra être repris depuis l’onglet « Tickets en attente »." });
    } catch (cause) {
      if (cause.status >= 400 && cause.status < 500) setTicketRequest(null);
      setNotice({ kind: "error", text: cause.message });
    } finally {
      active.current = false;
      setSaving(false);
      onBusy(false);
    }
  }
  const total = cart.reduce((sum, line) => sum + line.quantity * line.expectedPrice, 0);
  const paymentFields = <>
    <label>{appointment && !giftCardCode.trim() ? "Mode de règlement" : "Mode de règlement du complément"}<select value={paymentMethod} onChange={(event) => setPayment(event.target.value)} disabled={saving || !!pending || !!ticketRequest}>
      {Object.entries(methods).filter(([key]) => key !== "gift_card").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
    </select></label>
    <label>Code carte cadeau (facultatif)<input autoComplete="off" maxLength={35} value={giftCardCode} onChange={(event) => setGiftCardCode(event.target.value.toUpperCase())} placeholder="32 caractères" disabled={saving || !!pending || !!ticketRequest} /></label>
  </>;
  const retryHint = pending && !saving && <p className="field-hint">La réponse est incertaine. Réessayez la même demande pour éviter un doublon. Vérifiez le journal avant de recréer la vente.</p>;
  const submitButton = <button className="auth-submit" type="submit" disabled={saving || !!ticketRequest || cart.length === 0}>{saving ? "Enregistrement…" : pending ? "Réessayer la même vente" : "Confirmer le règlement reçu"}</button>;

  if (appointment) return <section className="client-card cash-checkout">
    <h2>Encaisser le rendez-vous</h2>
    <p>{appointment.first_name} {appointment.last_name} · {appointmentDate(appointment.starts_at)}</p>
    <Feedback notice={notice} />
    <form className="auth-form cash-checkout-form" onSubmit={submit}>
      <section className="cash-checkout-card">
        <h3>Prestations du rendez-vous</h3>
        <ul className="cash-line-list">
          {cart.map((line) => <li key={`${line.kind}:${line.id}`}><span>{line.name}</span><strong>{priceLabel(line.expectedPrice)}</strong></li>)}
        </ul>
        <p className="cash-amount"><span>Total du rendez-vous</span><strong>{priceLabel(total)}</strong></p>
        <p className="field-hint">Les prestations et le montant viennent de l’agenda.</p>
      </section>
      <section className="cash-checkout-card cash-payment-card">
        <h3>Règlement reçu</h3>
        {paymentFields}
        <p className="field-hint">BOOKILI enregistre uniquement un règlement déjà reçu et ne débite pas le client.</p>
        {retryHint}
        {submitButton}
      </section>
    </form>
  </section>;

  return <section className="client-card">
    <h2>{savedTicket ? `Ticket en attente n° ${savedTicket.id}` : "Enregistrer une vente"}</h2>
    <p>Enregistrez uniquement un règlement déjà reçu. BOOKILI ne débite ni carte ni compte bancaire.</p>
    <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      setSearch(new FormData(event.currentTarget).get("q").trim());
      setCatalogRefresh((value) => value + 1);
    }}>
      <label>Catalogue<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="product">Produits</option><option value="service">Prestations</option></select></label>
      <label>Nom ou référence<input name="q" maxLength={180} /></label>
      <button className="admin-nav-link" type="submit">Rechercher / actualiser</button>
    </form>
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!catalog && !error && <p role="status">Chargement du catalogue…</p>}
    {catalog?.items.length === 0 && <p>Aucun article actif correspondant.</p>}
    <div className="service-list">
      {catalog?.items.map((item) => <div className="service-row" key={item.id}>
        <span><strong>{item.name}</strong> · {priceLabel(item.price_dzd)}{kind === "product" && <> · Stock : {item.quantity}{item.reference && ` · ${item.reference}`}</>}</span>
        <button className="admin-nav-link" type="button" disabled={saving || !!pending || !!ticketRequest || cart.length >= 20 || (kind === "product" && Number(item.quantity) === 0) || cart.some((line) => line.kind === kind && String(line.id) === String(item.id))} onClick={() => add(item)}>Ajouter au panier</button>
      </div>)}
    </div>
    {catalog?.hasMore && <p>Plus de 50 résultats : affinez la recherche.</p>}
    <h3>Panier</h3>
    <Feedback notice={notice} />
    {cart.length === 0 ? <p>Ajoutez un produit ou une prestation au panier.</p> : <form className="auth-form" onSubmit={submit}>
      <fieldset className="form-fieldset" disabled={saving || !!pending || !!ticketRequest}>
        {cart.map((line, index) => <div className="service-row" key={`${line.kind}:${line.id}`}>
          <span>{line.name} · {priceLabel(line.expectedPrice)}</span>
          <label>Quantité<input type="number" min={1} max={100} step={1} required value={line.quantity} onChange={(event) => {
            const value = event.target.value;
            setCart((items) => items.map((item, position) => position === index ? { ...item, quantity: value === "" ? "" : Number(value) } : item));
          }} /></label>
          <button className="admin-nav-link" type="button" onClick={() => setCart((items) => items.filter((_, position) => position !== index))}>Retirer</button>
        </div>)}
      </fieldset>
      {paymentFields}
      <p><strong>Total : {priceLabel(total)}</strong></p>
      <p className="field-hint">Si le solde de la carte ne couvre pas toute la vente, le reste est enregistré selon le mode de règlement choisi.</p>
      <button className="admin-nav-link" type="button" disabled={saving || !!pending || !cart.length} onClick={saveTicket}>{saving && ticketRequest ? "Enregistrement…" : ticketRequest ? "Réessayer l’enregistrement du ticket" : savedTicket ? "Enregistrer les modifications du ticket" : "Mettre en attente"}</button>
      {retryHint}
      {submitButton}
    </form>}
  </section>;
}

function GiftCards({ csrfToken, onBusy, onRecorded }) {
  const [valueDzd, setValue] = useState(2000);
  const [paymentMethod, setPayment] = useState("cash");
  const [request, setRequest] = useState(null);
  const [issued, setIssued] = useState(null);
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const response = useCashData(new URLSearchParams({ view: "cards", status, page }).toString(), refresh);

  async function submit(event) {
    event.preventDefault();
    const body = request || { action: "issue", valueDzd, paymentMethod, requestKey: crypto.randomUUID() };
    setRequest(body);
    setSaving(true);
    onBusy(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-gift-cards.php", { csrfToken, body });
      setRequest(null);
      setRefresh((current) => current + 1);
      if (!result.code) {
        setNotice({ kind: "error", text: "Cette émission a déjà été traitée, mais le code est affiché une seule fois. Vérifiez la liste des cartes ; si vous n’avez pas récupéré le code, la carte ne peut pas être remise au bénéficiaire." });
      } else {
        setIssued(result);
        onRecorded();
      }
    } catch (cause) {
      if (cause.status >= 400 && cause.status < 500) setRequest(null);
      setNotice({ kind: "error", text: cause.message });
    } finally { setSaving(false); onBusy(false); }
  }
  return <>
    <section className="client-card">
      <h2>Vendre une carte cadeau</h2>
      <p>Valable dans ce salon pendant 12 mois. Encaissez le montant complet avant de remettre le code au bénéficiaire. Le code est affiché une seule fois et n’est pas récupérable.</p>
      {notice && <Feedback notice={notice} />}
      <form className="auth-form" onSubmit={submit}>
        <fieldset className="form-fieldset" disabled={saving || !!request}>
          <label>Montant de la carte (DA)<input type="number" min={500} max={10000000} step={1} required value={valueDzd} onChange={(event) => setValue(event.target.value === "" ? "" : Number(event.target.value))} /></label>
          <label>Mode de règlement reçu<select value={paymentMethod} onChange={(event) => setPayment(event.target.value)}>
            {Object.entries(methods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </fieldset>
        <button className="auth-submit" type="submit" disabled={saving || !valueDzd}>{saving ? "Émission…" : request ? "Réessayer la même émission" : "Encaisser et émettre la carte"}</button>
        {request && <p className="field-hint">Ne démarrez pas une nouvelle émission. Réessayez cette demande puis vérifiez la liste.</p>}
      </form>
      {issued && <div className="form-message form-success">
        <p>Carte n° {issued.cardId} · {priceLabel(issued.valueDzd)} · Valable jusqu’au {issued.expiresOn.split("-").reverse().join("/")}. Gardez ce code : il ne pourra pas être affiché à nouveau.</p>
        <label>Code à transmettre au bénéficiaire<input readOnly value={issued.code} onFocus={(event) => event.target.select()} /></label>
        <button className="admin-nav-link" type="button" onClick={async () => {
          try { await navigator.clipboard.writeText(issued.code); setNotice({ kind: "success", text: "Code copié. Remettez-le au bénéficiaire." }); }
          catch { setNotice({ kind: "error", text: "Copie impossible. Sélectionnez et copiez le code affiché." }); }
        }}>Copier le code</button>
      </div>}
    </section>
    <section className="client-card">
      <h2>Cartes émises par ce salon</h2>
      <div className="booking-toolbar">
        <label>Statut<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="all">Toutes les cartes</option>
          <option value="expired">Cartes expirées</option>
        </select></label>
        {response.data && <a className="admin-nav-link" href={apiUrl(`${endpoint}?${new URLSearchParams({ view: "cards-csv", status })}`)}>Exporter les cartes (CSV)</a>}
      </div>
      {response.error && <Feedback notice={{ kind: "error", text: response.error }} />}
      {!response.data && !response.error && <p role="status">Chargement…</p>}
      {response.data?.cards.length === 0 && <p>{status === "expired" ? "Aucune carte expirée." : "Aucune carte émise."}</p>}
      <div className="service-list">{response.data?.cards.map((card) => <article className="service-row" key={card.id}>
        <span><strong>Carte n° {card.id}</strong> · {priceLabel(card.balance_dzd)} / {priceLabel(card.initial_value_dzd)}<br />
          Valable jusqu’au {card.expires_on.split("-").reverse().join("/")} · {card.status === "active" ? Number(card.balance_dzd) ? "Active" : "Solde épuisé" : card.status === "voided" ? "Annulée" : "Expirée"}
        </span>
      </article>)}</div>
      <nav className="pagination" aria-label="Pages des cartes cadeaux">
        {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
        {response.data?.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
      </nav>
    </section>
  </>;
}

const drawerEndpoint = "professional-cash-drawer.php";
const drawerKinds = { deposit: "Dépôt d’espèces", withdrawal: "Retrait d’espèces", bank: "Remise en banque" };

function CashDrawer({ csrfToken, onBusy }) {
  const [date, setDate] = useState(algerianDate);
  const [page, setPage] = useState(1);
  const [revision, refresh] = useState(0);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(null);
  const [notice, setNotice] = useState(null);
  const [formVersion, resetForm] = useState(0);
  const { data, error } = useCashData(new URLSearchParams({ date, page }).toString(), revision, drawerEndpoint);

  async function save(body) {
    setSaving(true);
    onBusy(true);
    setNotice(null);
    try {
      await apiRequest(drawerEndpoint, { csrfToken, body });
      setPending(null);
      setNotice({ kind: "success", text: body.action === "open" ? "Fond de caisse enregistré." : "Mouvement enregistré." });
      setPage(1);
      resetForm((value) => value + 1);
      refresh((value) => value + 1);
    } catch (cause) {
      setPending(!cause.status || cause.status >= 500 ? body : null);
      setNotice({ kind: "error", text: cause.message });
      if (cause.status === 409) refresh((value) => value + 1);
    } finally {
      setSaving(false);
      onBusy(false);
    }
  }

  return <section className="client-card cash-drawer">
    <h2>Fond de caisse</h2>
    <p>Le montant attendu porte uniquement sur les espèces. Il ne remplace pas le comptage du tiroir.</p>
    <div className="booking-toolbar">
      <label>Journée (heure d’Algérie)<input type="date" value={date} min="2000-01-01" max={algerianDate()} disabled={saving || !!pending}
        onChange={(event) => {
          if (event.target.value) { setDate(event.target.value); setPage(1); setNotice(null); }
        }} /></label>
      <button className="admin-nav-link" type="button" disabled={saving} onClick={() => refresh((value) => value + 1)}>Actualiser</button>
    </div>
    <Feedback notice={notice} />
    {pending && <div>
      <p>Vérifiez le résultat en réessayant la même demande, sans saisir une seconde opération.</p>
      <button className="admin-nav-link" type="button" disabled={saving} onClick={() => save(pending)}>Réessayer la même demande</button>
    </div>}
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!data && !error && <p role="status">Chargement du fond de caisse…</p>}
    {data && <>
      <div className="cash-kpis">
        <article><span>Fond d’ouverture</span><strong>{data.opening ? priceLabel(data.opening.opening_dzd) : "Non renseigné"}</strong>
          {data.opening && <small>Enregistré : {appointmentDate(data.opening.opened_at)}</small>}</article>
        <article><span>Ventes en espèces, nettes des annulations</span><strong>{priceLabel(data.cashNetDzd)}</strong></article>
        {Object.entries(drawerKinds).map(([kind, label]) => <article key={kind}>
          <span>{label}</span><strong>{priceLabel(data.totals[kind])}</strong>
        </article>)}
        <article><span>Espèces attendues</span><strong>{data.expectedDzd === null ? "—" : priceLabel(data.expectedDzd)}</strong></article>
      </div>
      {data.expectedDzd < 0 && <p className="form-message form-error">Le montant attendu est négatif. Vérifiez le fond d’ouverture et les opérations de cette journée.</p>}
      {date === data.today && !pending && <form key={`${date}:${!!data.opening}:${formVersion}`} className="auth-form" onSubmit={(event) => {
        event.preventDefault();
        if (saving) return;
        const fields = new FormData(event.currentTarget);
        const body = { date, action: data.opening ? "move" : "open", amountDzd: Number(fields.get("amount")) };
        if (data.opening) Object.assign(body, { kind: fields.get("kind"), note: fields.get("note"), requestKey: crypto.randomUUID() });
        save(body);
      }}>
        <h3>{data.opening ? "Enregistrer un mouvement" : "Enregistrer le fond d’ouverture"}</h3>
        {!data.opening && <p className="field-hint">Indiquez les espèces présentes avant les opérations de la journée. Ce montant n’est pas modifiable après enregistrement.</p>}
        <fieldset className="form-fieldset" disabled={saving}>
          {data.opening && <label>Type<select name="kind">{Object.entries(drawerKinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label>}
          <label>Montant en DA<input name="amount" type="number" inputMode="numeric" min={data.opening ? 1 : 0} max={10000000} step={1} required /></label>
          {data.opening && <label>Motif<input name="note" maxLength={160} required /></label>}
        </fieldset>
        <button className="auth-submit" type="submit" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer"}</button>
      </form>}
      {date !== data.today && <p className="field-hint">Journée passée : consultation uniquement.</p>}
      <section className="cash-report-section">
        <h3>Mouvements d’espèces</h3>
        {data.movements.length === 0 ? <p>Aucun mouvement sur cette journée.</p> : <div className="cash-journal-table"><table>
          <thead><tr><th scope="col">Enregistré le</th><th scope="col">Type</th><th scope="col">Montant</th><th scope="col">Motif</th></tr></thead>
          <tbody>{data.movements.map((row) => <tr key={row.id}>
            <th scope="row">{appointmentDate(row.recorded_at)}</th><td>{drawerKinds[row.kind]}</td>
            <td>{priceLabel(row.kind === "deposit" ? row.amount_dzd : -row.amount_dzd)}</td><td>{row.note}</td>
          </tr>)}</tbody>
        </table></div>}
        <nav className="pagination" aria-label="Pages des mouvements">
          {page > 1 && <button className="admin-nav-link" type="button" disabled={saving} onClick={() => setPage(page - 1)}>Précédent</button>}
          {data.hasMore && <button className="admin-nav-link" type="button" disabled={saving} onClick={() => setPage(page + 1)}>Suivant</button>}
        </nav>
      </section>
    </>}
  </section>;
}

function CashReports({ revision, onSelect }) {
  const [period, setPeriod] = useState(() => currentCashPeriod("month"));
  const [kind, setKind] = useState("service");
  const [page, setPage] = useState(1);
  const isVoids = kind === "voids";
  const isTeam = kind === "team";
  const isComparison = kind === "comparison";
  const view = isVoids ? "voids" : isTeam ? "team-report" : isComparison ? "comparison" : "items-report";
  const filters = view === "items-report" ? { ...period, kind } : period;
  const { data, error } = useCashData(new URLSearchParams({ view, ...filters, page }).toString(), revision);
  return <section className="client-card cash-reports">
    <h2>Rapports de caisse</h2>
    <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      setPeriod({ from: fields.get("from"), to: fields.get("to") });
      setPage(1);
    }}>
      <label>Rapport<select value={kind} onChange={(event) => { setKind(event.target.value); setPage(1); }}>
        <option value="service">Ventes par prestation</option>
        <option value="product">Ventes par produit</option>
        <option value="team">Ventes par collaborateur</option>
        <option value="comparison">Comparaison de périodes</option>
        <option value="voids">Journal des annulations</option>
      </select></label>
      <label>Du<input name="from" type="date" required defaultValue={period.from} max={algerianDate()} /></label>
      <label>Au<input name="to" type="date" required defaultValue={period.to} max={algerianDate()} /></label>
      <button className="admin-nav-link" type="submit">Afficher</button>
      {data && <a className="admin-nav-link" href={apiUrl(`${endpoint}?${new URLSearchParams({ view: `${view}-csv`, ...filters })}`)}>Exporter le rapport (CSV)</a>}
    </form>
    <p>{isVoids ? "Les annulations de ventes sont affichées à leur date d’enregistrement."
      : isTeam ? "Les ventes sont rattachées au collaborateur du rendez-vous associé. Les autres ventes sont non attribuées."
        : isComparison ? "La période sélectionnée est comparée aux jours qui la précèdent immédiatement, sur la même durée."
          : "Les libellés et les prix sont ceux enregistrés à la vente. Les annulations sont déduites à leur date d’enregistrement."}</p>
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!data && !error && <p role="status">Chargement du rapport…</p>}
    {data && isComparison && <div className="cash-journal-table"><table>
      <thead><tr><th scope="col">Indicateur</th>
        {[[data.current, "Sélectionnée"], [data.previous, "Précédente"]].map(([range, label]) => <th key={label} scope="col">{label}
          <small>{range.from.split("-").reverse().join("/")} – {range.to.split("-").reverse().join("/")}</small></th>)}
        <th scope="col">Écart</th></tr></thead>
      <tbody>{[
        ["sale_count", "Ventes"], ["void_count", "Annulations"], ["gross_dzd", "Ventes brutes"],
        ["void_dzd", "Montant des annulations"], ["net_dzd", "Ventes nettes"], ["received_dzd", "Encaissé net"],
      ].map(([key, label]) => {
        const format = key.endsWith("_dzd") ? priceLabel : (value) => value;
        const current = data.current[key], previous = data.previous[key];
        return <tr key={key}><th scope="row">{label}</th><td>{format(current)}</td><td>{format(previous)}</td>
          <td>{current > previous ? "+" : ""}{format(current - previous)}</td></tr>;
      })}</tbody>
    </table></div>}
    {data?.entries?.length === 0 && <p>{isVoids ? "Aucune annulation de vente sur cette période." : "Aucune opération sur cette période."}</p>}
    {data?.entries?.length > 0 && <div className="cash-journal-table"><table>
      <thead><tr>{(isVoids ? ["Vente", "Mode", "Montant (déduction)", "Motif"]
        : isTeam ? ["Collaborateur", "Ventes", "Annulations", "Brut", "Montant annulé", "Net", "Encaissé net"]
        : ["Nom à la vente", "Qté vendue", "Qté annulée", "Brut", "Annulations", "Net"]).map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead>
      <tbody>{isVoids ? data.entries.map((row) => <tr key={row.id}>
        <th scope="row"><button className="cash-journal-sale-link" type="button" onClick={() => onSelect(row.id)}>n° {row.id}</button><small>{appointmentDate(row.event_at)}</small></th>
        <td>{methods[row.payment_method]}</td><td>{priceLabel(row.amount_dzd)}</td><td>{row.reason}</td>
      </tr>) : isTeam ? data.entries.map((row) => <tr key={row.staff_id ?? "unassigned"}>
        <th scope="row">{row.staff_name}{row.staff_id !== null && !Number(row.is_active) && <small>Inactif</small>}</th>
        <td>{row.sale_count}</td><td>{row.void_count}</td><td>{priceLabel(row.gross_dzd)}</td>
        <td>{priceLabel(row.void_dzd)}</td><td>{priceLabel(row.net_dzd)}</td><td>{priceLabel(row.received_dzd)}</td>
      </tr>) : data.entries.map((row) => <tr key={`${row.item_id}:${row.item_name}`}>
        <th scope="row">{row.item_name}<small>n° {row.item_id}</small></th>
        <td>{row.sold_quantity}</td><td>{row.void_quantity}</td>
        <td>{priceLabel(row.gross_dzd)}</td><td>{priceLabel(row.void_dzd)}</td><td>{priceLabel(row.gross_dzd - row.void_dzd)}</td>
      </tr>)}</tbody>
    </table></div>}
    <nav className="pagination" aria-label="Pages des rapports">
      {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
      {data?.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
    </nav>
  </section>;
}

function Payments({ revision, onSelect }) {
  const [filters, setFilters] = useState(() => ({ ...currentCashPeriod("day"), method: "" }));
  const [page, setPage] = useState(1);
  const { data, error } = useCashData(new URLSearchParams({ view: "payments", ...filters, page }).toString(), revision);
  return <section className="client-card cash-payments">
    <h2>Règlements</h2>
    <p>Les montants encaissés et les cartes cadeaux utilisées sont séparés. Les annulations apparaissent à leur date, en négatif.</p>
    <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      setFilters(Object.fromEntries(new FormData(event.currentTarget)));
      setPage(1);
    }}>
      <label>Du<input name="from" type="date" required defaultValue={filters.from} max={algerianDate()} /></label>
      <label>Au<input name="to" type="date" required defaultValue={filters.to} max={algerianDate()} /></label>
      <label>Mode de règlement<select name="method" defaultValue={filters.method}>
        <option value="">Tous les modes</option>
        {Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <button className="admin-nav-link" type="submit">Afficher</button>
      {data && <a className="admin-nav-link" href={apiUrl(`${endpoint}?${new URLSearchParams({ view: "payments-csv", ...filters })}`)}>Exporter les règlements (CSV)</a>}
    </form>
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!data && !error && <p role="status">Chargement des règlements…</p>}
    {data && <>
      <p><strong>Encaissé net : {priceLabel(data.totals.collected)}</strong> · Cartes cadeaux utilisées nettes : {priceLabel(data.totals.gift)}</p>
      {data.entries.length === 0 ? <p>Aucun règlement pour ces filtres.</p> : <div className="cash-journal-table">
        <table>
          <thead><tr><th scope="col">Vente</th><th scope="col">Opération</th><th scope="col">Mode</th><th scope="col">Encaissé</th><th scope="col">Carte cadeau</th></tr></thead>
          <tbody>{data.entries.map((row) => <tr key={`${row.id}:${row.event_kind}`}>
            <th scope="row"><button className="cash-journal-sale-link" type="button" onClick={() => onSelect(row.id)}>n° {row.id}</button><small>{appointmentDate(row.event_at)}</small></th>
            <td>{row.event_kind === "void" ? "Annulation" : "Vente"}</td>
            <td>{Number(row.collected_dzd) === 0 ? methods.gift_card : methods[row.payment_method]}</td>
            <td>{priceLabel(row.collected_dzd)}</td><td>{priceLabel(row.gift_card_applied_dzd)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      <nav className="pagination" aria-label="Pages des règlements">
        {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
        {data.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
      </nav>
    </>}
  </section>;
}

function Journal({ csrfToken, saleId, recorded, onSelect, revision, onChanged, onBusy, busy }) {
  const [dates, setDates] = useState(() => ({ from: algerianDate(), to: algerianDate() }));
  const [page, setPage] = useState(1);
  const { data, error } = useCashData(new URLSearchParams({ ...dates, page }).toString(), revision);
  const detailHeading = useRef(null);
  useEffect(() => {
    if (saleId !== null) detailHeading.current?.focus();
  }, [saleId]);
  return <section className="client-card cash-journal">
    {recorded && <p className="form-message form-success cash-recorded" role="status"><strong>Règlement enregistré</strong> · Vente n° {recorded.saleId}{recorded.totalDzd != null && ` · ${priceLabel(recorded.totalDzd)}`}</p>}
    <h2>Journal de caisse</h2>
    <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      setDates({ from: fields.get("from"), to: fields.get("to") });
      setPage(1);
    }}>
      <label>Du<input name="from" type="date" required defaultValue={dates.from} max={algerianDate()} /></label>
      <label>Au<input name="to" type="date" required defaultValue={dates.to} max={algerianDate()} /></label>
      <button className="admin-nav-link" type="submit">Afficher</button>
      {data && <a className="admin-nav-link" href={apiUrl(`${endpoint}?${new URLSearchParams({ ...dates, view: "csv" })}`)}>Exporter le journal (CSV)</a>}
      {data && <strong className="cash-journal-net">Total net : {priceLabel(data.netDzd)}</strong>}
    </form>
    <div className={`cash-journal-layout${saleId !== null ? " cash-journal-split" : ""}`}>
      {saleId !== null && <SaleDetail key={saleId} headingRef={detailHeading} saleId={saleId} revision={revision} csrfToken={csrfToken} onChanged={onChanged} onBusy={onBusy} />}
      <div className="cash-journal-entries">
        <h3>Opérations</h3>
        {error && <Feedback notice={{ kind: "error", text: error }} />}
        {!data && !error && <p role="status">Chargement du journal…</p>}
        {data?.entries.length === 0 && <p>Aucune opération sur cette période.</p>}
        {data?.entries.length > 0 && <div className="cash-journal-table">
          <table>
            <thead><tr><th scope="col">Vente</th><th scope="col">Opération</th><th scope="col">Mode</th><th scope="col">Montant</th></tr></thead>
            <tbody>
              {data.entries.map((row) => <tr key={`${row.id}:${row.event_kind}`} className={String(row.id) === String(saleId) ? "cash-journal-selected" : undefined}>
                <th scope="row">
                  <button className="cash-journal-sale-link" type="button" disabled={busy} aria-label={`Voir la vente n° ${row.id}`} onClick={() => String(row.id) === String(saleId) ? detailHeading.current?.focus() : onSelect(row.id)}>n° {row.id}</button>
                  <small>{appointmentDate(row.event_at)}</small>
                </th>
                <td><span className={`cash-journal-event${row.event_kind === "void" ? " cash-journal-void" : ""}`}>{row.event_kind === "void" ? "Annulation" : "Vente"}</span></td>
                <td>{methods[row.payment_method]}</td>
                <td>{priceLabel(row.amount_dzd)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
        <nav className="pagination" aria-label="Pages du journal">
          {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
          {data?.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
        </nav>
      </div>
    </div>
  </section>;
}

function SaleDetail({ saleId, revision, csrfToken, onChanged, onBusy, headingRef }) {
  const { data: sale, error } = useCashData(`view=sale&saleId=${encodeURIComponent(saleId)}`, revision);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);
  async function cancel(event) {
    event.preventDefault();
    if (!window.confirm("Confirmer l’annulation de cette vente entière et la remise des produits en stock ?")) return;
    setSaving(true);
    onBusy(true);
    try {
      await apiRequest(endpoint, { csrfToken, body: { action: "void", saleId, reason } });
      setNotice({ kind: "success", text: "Annulation enregistrée dans le journal." });
      onChanged();
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); onBusy(false); }
  }
  return <div className="appointment-card cash-sale-detail">
    <h3 tabIndex={-1} ref={headingRef}>Détail de la vente n° {saleId}</h3>
    <Feedback notice={notice} />
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!sale && !error && <p role="status">Chargement de la vente…</p>}
    {sale && <>
      <p>{appointmentDate(sale.recorded_at)} · {methods[sale.payment_method]}</p>
      <ul className="cash-line-list">{sale.lines.map((line) => <li key={`${line.item_kind}:${line.item_id}`}>
        <span>{line.quantity} × {line.item_name}{Number(line.quantity) !== 1 && <small> · {priceLabel(line.unit_price_dzd)} l’unité</small>}</span>
        <strong>{priceLabel(line.quantity * line.unit_price_dzd)}</strong>
      </li>)}</ul>
      <p className="cash-amount"><span>Total de la vente</span><strong>{priceLabel(sale.total_dzd)}</strong></p>
      <p>Encaissé : {priceLabel(sale.collected_dzd)}{Number(sale.gift_card_applied_dzd) > 0 && ` · Carte cadeau : ${priceLabel(sale.gift_card_applied_dzd)}`}</p>
      {sale.voided_at ? <p>Annulée le {appointmentDate(sale.voided_at)} : {sale.void_reason}</p> :
        <details className="cash-sale-void">
          <summary>Annuler la vente entière</summary>
          <form className="auth-form" onSubmit={cancel}>
            <p className="field-hint">Utilisez cette action pour une vente entièrement annulée et des produits effectivement remis en stock. Aucun remboursement bancaire n’est déclenché.</p>
            <label>Motif d’annulation<input required maxLength={255} value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} /></label>
            <button type="submit" className="admin-nav-link" disabled={saving}>{saving ? "Enregistrement…" : "Confirmer l’annulation"}</button>
          </form>
        </details>}
    </>}
  </div>;
}
