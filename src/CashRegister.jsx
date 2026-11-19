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
      .catch((cause) => { if (!controller.signal.aborted) setResponse({ query, revision, error: cause.message }); });
    return () => controller.abort();
  }, [api, query, revision]);
  return response?.query === query && response.revision === revision ? response : {};
}

function Feedback({ notice }) {
  if (!notice) return null;
  return <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>;
}

export default function CashRegister({ csrfToken, appointment = null, onAppointmentHandled }) {
  const [view, setView] = useState("sale");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saleId, setSaleId] = useState(null);
  const [activeTicket, setActiveTicket] = useState(null);
  const refresh = () => setRevision((value) => value + 1);
  return <>
    <nav className="workspace-tabs" aria-label="Caisse professionnelle">
      {[["sale", "Vente"], ["tickets", "Tickets en attente"], ["overview", "Synthèse"], ["gift-cards", "Cartes cadeaux"], ["journal", "Journal"], ["inventory", "Stocks"]].map(([value, name]) =>
        <button key={value} type="button" disabled={(busy && view !== value) || (appointment && value === "tickets")} aria-current={view === value ? "page" : undefined} onClick={() => setView(value)}>{name}</button>
      )}
    </nav>
    <div hidden={view !== "sale"}>
      <SaleForm key={`${appointment?.id || "regular"}:${activeTicket?.id || "new"}:${activeTicket?.revision || 0}`} csrfToken={csrfToken} revision={revision} appointment={appointment} ticket={activeTicket} onBusy={setBusy} onTicketSaved={refresh} onRecorded={(result) => {
        setSaleId(result.saleId);
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
    {view === "journal" && <Journal csrfToken={csrfToken} saleId={saleId} onSelect={setSaleId} revision={revision} onChanged={refresh} onBusy={setBusy} />}
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

function CashOverview({ revision }) {
  const [dates, setDates] = useState(() => ({ from: algerianDate(), to: algerianDate() }));
  const [period, setPeriod] = useState(dates);
  const query = new URLSearchParams({ view: "overview", ...period }).toString();
  const { data, error } = useCashData(query, revision);
  const maximum = Math.max(1, ...(data?.days || []).map((day) => Math.abs(day.net_dzd)));
  return <section className="client-card cash-overview">
    <header className="cash-overview-header">
      <div><h2>Synthèse de caisse</h2><p>Ventes, annulations et règlements enregistrés pour la période choisie.</p></div>
      <button className="admin-nav-link" type="button" onClick={() => window.print()}>Imprimer</button>
    </header>
    <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      const fields = new FormData(event.currentTarget);
      setPeriod({ from: fields.get("from"), to: fields.get("to") });
    }}>
      <label>Du<input name="from" type="date" required max={algerianDate()} value={dates.from} onChange={(event) => setDates({ ...dates, from: event.target.value })} /></label>
      <label>Au<input name="to" type="date" required max={algerianDate()} value={dates.to} onChange={(event) => setDates({ ...dates, to: event.target.value })} /></label>
      <button className="admin-nav-link" type="submit">Afficher la période</button>
    </form>
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!data && !error && <p role="status">Calcul de la synthèse…</p>}
    {data && <>
      <div className="cash-kpis">
        <article><span>Ventes brutes</span><strong>{priceLabel(data.summary.gross_dzd)}</strong><small>{data.summary.sale_count} vente(s)</small></article>
        <article><span>Annulations</span><strong>{priceLabel(data.summary.void_dzd)}</strong><small>{data.summary.void_count} annulation(s)</small></article>
        <article><span>Net sur la période</span><strong>{priceLabel(data.summary.net_dzd)}</strong><small>Ventes moins annulations</small></article>
        <article><span>Règlements encaissés</span><strong>{priceLabel(data.summary.received_dzd)}</strong><small>Espèces, carte, virement et autres</small></article>
        <article><span>Cartes cadeaux utilisées</span><strong>{priceLabel(data.summary.gift_card_dzd)}</strong><small>Montant consommé sur les ventes</small></article>
      </div>
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
  const { data: catalog, error } = useCashData(new URLSearchParams({ view: "catalog", q: search, kind }).toString(), `${revision}:${catalogRefresh}`);

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
  return <section className="client-card">
    <h2>{appointment ? `Encaisser le rendez-vous de ${appointment.first_name} ${appointment.last_name}` : savedTicket ? `Ticket en attente n° ${savedTicket.id}` : "Enregistrer une vente"}</h2>
    {appointment && <p>{appointment.service_name} · {appointment.starts_at.slice(0, 16)} · {priceLabel(appointment.price_dzd)}</p>}
    <p>Enregistrez uniquement un règlement déjà reçu. BOOKILI ne débite ni carte ni compte bancaire.</p>
    {!appointment && <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      setSearch(new FormData(event.currentTarget).get("q").trim());
      setCatalogRefresh((value) => value + 1);
    }}>
      <label>Catalogue<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="product">Produits</option><option value="service">Prestations</option></select></label>
      <label>Nom ou référence<input name="q" maxLength={180} /></label>
      <button className="admin-nav-link" type="submit">Rechercher / actualiser</button>
    </form>}
    {!appointment && error && <Feedback notice={{ kind: "error", text: error }} />}
    {!appointment && !catalog && !error && <p role="status">Chargement du catalogue…</p>}
    {!appointment && catalog?.items.length === 0 && <p>Aucun article actif correspondant.</p>}
    {!appointment && <div className="service-list">
      {catalog?.items.map((item) => <div className="service-row" key={item.id}>
        <span><strong>{item.name}</strong> · {priceLabel(item.price_dzd)}{kind === "product" && <> · Stock : {item.quantity}{item.reference && ` · ${item.reference}`}</>}</span>
        <button className="admin-nav-link" type="button" disabled={saving || !!pending || !!ticketRequest || cart.length >= 20 || (kind === "product" && Number(item.quantity) === 0) || cart.some((line) => line.kind === kind && String(line.id) === String(item.id))} onClick={() => add(item)}>Ajouter au panier</button>
      </div>)}
    </div>}
    {!appointment && catalog?.hasMore && <p>Plus de 50 résultats : affinez la recherche.</p>}
    <h3>{appointment ? "Prestations à encaisser" : "Panier"}</h3>
    <Feedback notice={notice} />
    {cart.length === 0 ? <p>Ajoutez un produit ou une prestation au panier.</p> : <form className="auth-form" onSubmit={submit}>
      {appointment ? <div className="agenda-service-lines">
        {cart.map((line) => <p key={`${line.kind}:${line.id}`}>{line.name} · {priceLabel(line.expectedPrice)}</p>)}
      </div> : <fieldset className="form-fieldset" disabled={saving || !!pending || !!ticketRequest}>
        {cart.map((line, index) => <div className="service-row" key={`${line.kind}:${line.id}`}>
          <span>{line.name} · {priceLabel(line.expectedPrice)}</span>
          <label>Quantité<input type="number" min={1} max={100} step={1} required value={line.quantity} onChange={(event) => {
            const value = event.target.value;
            setCart((items) => items.map((item, position) => position === index ? { ...item, quantity: value === "" ? "" : Number(value) } : item));
          }} /></label>
          <button className="admin-nav-link" type="button" onClick={() => setCart((items) => items.filter((_, position) => position !== index))}>Retirer</button>
        </div>)}
      </fieldset>}
      <label>{appointment ? "Mode de règlement" : "Mode de règlement du complément"}<select value={paymentMethod} onChange={(event) => setPayment(event.target.value)} disabled={saving || !!pending || !!ticketRequest}>
        {Object.entries(methods).filter(([key]) => key !== "gift_card").map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Code carte cadeau (facultatif)<input autoComplete="off" maxLength={35} value={giftCardCode} onChange={(event) => setGiftCardCode(event.target.value.toUpperCase())} placeholder="32 caractères" disabled={saving || !!pending || !!ticketRequest} /></label>
      <p><strong>Total : {priceLabel(cart.reduce((sum, line) => sum + line.quantity * line.expectedPrice, 0))}</strong></p>
      {appointment && <p className="field-hint">Les prestations et le montant correspondent au rendez-vous. Une seule vente peut être enregistrée par rendez-vous.</p>}
      {!appointment && <p className="field-hint">Si le solde de la carte ne couvre pas toute la vente, le reste est enregistré selon le mode de règlement choisi.</p>}
      {!appointment && <button className="admin-nav-link" type="button" disabled={saving || !!pending || !cart.length} onClick={saveTicket}>{saving && ticketRequest ? "Enregistrement…" : ticketRequest ? "Réessayer l’enregistrement du ticket" : savedTicket ? "Enregistrer les modifications du ticket" : "Mettre en attente"}</button>}
      {pending && !saving && <p className="field-hint">La réponse est incertaine. Réessayez la même demande pour éviter un doublon. Vérifiez le journal avant de recréer la vente.</p>}
      <button className="auth-submit" type="submit" disabled={saving || !!ticketRequest}>{saving ? "Enregistrement…" : pending ? "Réessayer la même vente" : "Confirmer le règlement reçu"}</button>
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
  const response = useCashData(new URLSearchParams({ page }).toString(), refresh, "professional-gift-cards.php");

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
      {response.error && <Feedback notice={{ kind: "error", text: response.error }} />}
      {!response.data && !response.error && <p role="status">Chargement…</p>}
      {response.data?.cards.length === 0 && <p>Aucune carte émise.</p>}
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

function Journal({ csrfToken, saleId, onSelect, revision, onChanged, onBusy }) {
  const [dates, setDates] = useState(() => ({ from: algerianDate(), to: algerianDate() }));
  const [page, setPage] = useState(1);
  const { data, error } = useCashData(new URLSearchParams({ ...dates, page }).toString(), revision);
  return <section className="client-card">
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
    </form>
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!data && !error && <p role="status">Chargement du journal…</p>}
    {data && <p><strong>Total net sur la période : {priceLabel(data.netDzd)}</strong></p>}
    {data?.entries.length === 0 && <p>Aucune opération sur cette période.</p>}
    <div className="service-list">
      {data?.entries.map((row) => <div className="service-row" key={`${row.id}:${row.event_kind}`}>
        <span><strong>{row.event_kind === "void" ? "Annulation" : "Vente"} n° {row.id} · {priceLabel(row.amount_dzd)}</strong><br />{appointmentDate(row.event_at)} · {methods[row.payment_method]}</span>
        <button className="admin-nav-link" type="button" onClick={() => onSelect(row.id)}>Voir la vente n° {row.id}</button>
      </div>)}
    </div>
    <nav className="pagination" aria-label="Pages du journal">
      {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
      {data?.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
    </nav>
    {saleId !== null && <SaleDetail key={saleId} saleId={saleId} revision={revision} csrfToken={csrfToken} onChanged={onChanged} onBusy={onBusy} />}
  </section>;
}

function SaleDetail({ saleId, revision, csrfToken, onChanged, onBusy }) {
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
  return <div className="appointment-card">
    <h3>Détail de la vente n° {saleId}</h3>
    <Feedback notice={notice} />
    {error && <Feedback notice={{ kind: "error", text: error }} />}
    {!sale && !error && <p role="status">Chargement de la vente…</p>}
    {sale && <>
      <p>{appointmentDate(sale.recorded_at)} · {methods[sale.payment_method]} · Vente : <strong>{priceLabel(sale.total_dzd)}</strong> · Encaissé : {priceLabel(sale.collected_dzd)}{Number(sale.gift_card_applied_dzd) > 0 && ` · Carte cadeau : ${priceLabel(sale.gift_card_applied_dzd)}`}</p>
      <ul>{sale.lines.map((line) => <li key={`${line.item_kind}:${line.item_id}`}>{line.quantity} × {line.item_name} à {priceLabel(line.unit_price_dzd)}</li>)}</ul>
      {sale.voided_at ? <p>Annulée le {appointmentDate(sale.voided_at)} : {sale.void_reason}</p> :
        <form className="auth-form" onSubmit={cancel}>
          <p className="field-hint">Utilisez cette action pour une vente entièrement annulée et des produits effectivement remis en stock. Aucun remboursement bancaire n’est déclenché.</p>
          <label>Motif d’annulation<input required maxLength={255} value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} /></label>
          <button type="submit" className="admin-nav-link" disabled={saving}>{saving ? "Enregistrement…" : "Annuler la vente entière"}</button>
        </form>}
    </>}
  </div>;
}
