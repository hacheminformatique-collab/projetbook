import { useEffect, useRef, useState } from "react";
import { algerianDate, apiRequest, apiUrl, appointmentDate, priceLabel } from "./api-client.js";
import Inventory from "./Inventory.jsx";

const endpoint = "professional-cash.php";
const methods = { cash: "Espèces", card: "Carte", transfer: "Virement", other: "Autre" };

function useCashData(query, revision = 0) {
  const [response, setResponse] = useState(null);
  useEffect(() => {
    if (!query) return undefined;
    const controller = new AbortController();
    apiRequest(`${endpoint}?${query}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResponse({ query, revision, data }); })
      .catch((cause) => { if (!controller.signal.aborted) setResponse({ query, revision, error: cause.message }); });
    return () => controller.abort();
  }, [query, revision]);
  return response?.query === query && response.revision === revision ? response : {};
}

function Feedback({ notice }) {
  if (!notice) return null;
  return <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>;
}

export default function CashRegister({ csrfToken }) {
  const [view, setView] = useState("sale");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saleId, setSaleId] = useState(null);
  const refresh = () => setRevision((value) => value + 1);
  return <>
    <nav className="workspace-tabs" aria-label="Caisse professionnelle">
      {[["sale", "Vente"], ["journal", "Journal"], ["inventory", "Stocks"]].map(([value, name]) =>
        <button key={value} type="button" disabled={busy && view !== value} aria-current={view === value ? "page" : undefined} onClick={() => setView(value)}>{name}</button>
      )}
    </nav>
    <div hidden={view !== "sale"}>
      <SaleForm csrfToken={csrfToken} revision={revision} onBusy={setBusy} onRecorded={(id) => {
        setSaleId(id);
        refresh();
        setView("journal");
      }} />
    </div>
    {view === "journal" && <Journal csrfToken={csrfToken} saleId={saleId} onSelect={setSaleId} revision={revision} onChanged={refresh} onBusy={setBusy} />}
    {view === "inventory" && <Inventory csrfToken={csrfToken} />}
  </>;
}

function SaleForm({ csrfToken, revision, onBusy, onRecorded }) {
  const [kind, setKind] = useState("product");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState([]);
  const [paymentMethod, setPayment] = useState("cash");
  const [notice, setNotice] = useState(null);
  const [pending, setPending] = useState(null);
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
      const body = pending || { action: "record", requestKey: crypto.randomUUID(), paymentMethod, lines: cart.map(({ name: _name, ...line }) => line) };
      setPending(body);
      const result = await apiRequest(endpoint, { csrfToken, body });
      setCart([]);
      setPending(null);
      onRecorded(result.saleId);
    } catch (cause) {
      if (cause.status >= 400 && cause.status < 500) setPending(null);
      setNotice({ kind: "error", text: cause.message });
    } finally {
      active.current = false;
      setSaving(false);
      onBusy(false);
    }
  }
  return <section className="client-card">
    <h2>Enregistrer une vente</h2>
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
        <button className="admin-nav-link" type="button" disabled={saving || !!pending || cart.length >= 20 || (kind === "product" && Number(item.quantity) === 0) || cart.some((line) => line.kind === kind && String(line.id) === String(item.id))} onClick={() => add(item)}>Ajouter au panier</button>
      </div>)}
    </div>
    {catalog?.hasMore && <p>Plus de 50 résultats : affinez la recherche.</p>}
    <h3>Panier</h3>
    <Feedback notice={notice} />
    {cart.length === 0 ? <p>Ajoutez un produit ou une prestation au panier.</p> : <form className="auth-form" onSubmit={submit}>
      <fieldset className="form-fieldset" disabled={saving || !!pending}>
        {cart.map((line, index) => <div className="service-row" key={`${line.kind}:${line.id}`}>
          <span>{line.name} · {priceLabel(line.expectedPrice)}</span>
          <label>Quantité<input type="number" min={1} max={100} step={1} required value={line.quantity} onChange={(event) => {
            const value = event.target.value;
            setCart((items) => items.map((item, position) => position === index ? { ...item, quantity: value === "" ? "" : Number(value) } : item));
          }} /></label>
          <button className="admin-nav-link" type="button" onClick={() => setCart((items) => items.filter((_, position) => position !== index))}>Retirer</button>
        </div>)}
        <label>Mode de règlement<select value={paymentMethod} onChange={(event) => setPayment(event.target.value)}>
          {Object.entries(methods).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </fieldset>
      <p><strong>Total : {priceLabel(cart.reduce((sum, line) => sum + line.quantity * line.expectedPrice, 0))}</strong></p>
      {pending && !saving && <p className="field-hint">La réponse est incertaine. Réessayez la même demande pour éviter un doublon. Vérifiez le journal avant de recréer la vente.</p>}
      <button className="auth-submit" type="submit" disabled={saving}>{saving ? "Enregistrement…" : pending ? "Réessayer la même vente" : "Confirmer le règlement reçu"}</button>
    </form>}
  </section>;
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
      <p>{appointmentDate(sale.recorded_at)} · {methods[sale.payment_method]} · <strong>{priceLabel(sale.total_dzd)}</strong></p>
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
