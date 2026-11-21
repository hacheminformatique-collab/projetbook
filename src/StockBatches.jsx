import { useEffect, useState } from "react";
import { apiRequest } from "./api-client.js";

const labels = { in: "Entrées en masse", out: "Sorties en masse", count: "Comptage physique en masse" };

export default function StockBatches({ csrfToken, onChanged }) {
  const [shown, setShown] = useState(false);
  return <section className="client-card" aria-label="Opérations de stock en masse">
    <h2>Opérations de stock en masse</h2>
    <p>Enregistrez des mouvements ou un comptage pour 2 à 50 produits. Si une ligne est refusée, aucune ligne n’est enregistrée.</p>
    {shown ? <BatchForm csrfToken={csrfToken} onChanged={onChanged} onClose={() => setShown(false)} />
      : <button type="button" className="admin-nav-link" onClick={() => setShown(true)}>Préparer une opération</button>}
  </section>;
}

function BatchForm({ csrfToken, onChanged, onClose }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ q: "", page: 1 });
  const [result, setResult] = useState(null);
  const [searchError, setSearchError] = useState("");
  const [items, setItems] = useState([]);
  const [kind, setKind] = useState("in");
  const [reason, setReason] = useState("");
  const [review, setReview] = useState(null);
  const [pending, setPending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setSearchError("");
    apiRequest(`professional-products.php?${new URLSearchParams(search)}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((error) => { if (!controller.signal.aborted) setSearchError(error.message); });
    return () => controller.abort();
  }, [search]);

  const after = (item) => kind === "count" ? Number(item.input)
    : Number(item.quantity) + (kind === "out" ? -1 : 1) * Number(item.input);
  const invalid = items.some((item) => after(item) < 0 || after(item) > 1000000);
  const candidates = result?.products.filter((product) => !items.some((item) => item.id === product.id));

  async function save() {
    if (saving || !review) return;
    setSaving(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-stock-batches.php", { csrfToken, body: review });
      setReview(null);
      setItems([]);
      setReason("");
      setSearch({ ...search });
      setPending(false);
      onChanged();
      setNotice({ text: `Opération n° ${result.batchId} enregistrée.` });
    } catch (error) {
      const rejected = error.status >= 400 && error.status < 500;
      setPending(!rejected);
      if (rejected) {
        setReview(null);
        setSearch({ ...search });
      }
      setNotice({ error: true, text: error.status === 409
        ? `${error.message} Si le stock a changé, retirez et resélectionnez le produit concerné, puis vérifiez sa quantité.` : error.message });
    } finally { setSaving(false); }
  }

  return <>
    {notice && <p role={notice.error ? "alert" : "status"}>{notice.text}</p>}
    {!review && <form className="booking-toolbar" onSubmit={(event) => {
      event.preventDefault();
      setSearch({ q: query.trim(), page: 1 });
    }}>
      <label>Rechercher un produit pour le lot<input value={query} maxLength={180} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="submit" className="admin-nav-link">Chercher</button>
    </form>}
    {!review && searchError && <p role="alert">{searchError}</p>}
    {!review && !result && !searchError && <p role="status">Recherche des produits…</p>}
    {!review && result && <nav className="pagination" aria-label="Pages des produits pour le lot">
      {search.page > 1 && <button type="button" className="admin-nav-link" onClick={() => setSearch({ ...search, page: search.page - 1 })}>Précédent</button>}
      {result.hasMore && <button type="button" className="admin-nav-link" onClick={() => setSearch({ ...search, page: search.page + 1 })}>Suivant</button>}
    </nav>}
    {review ? <div>
      <h3>Vérifier : {labels[kind]}</h3>
      <p>Motif : {reason.trim()}</p>
      <ul>{items.map((item) => <li key={item.id}>{item.name} : {item.quantity} → {after(item)} unité(s)</li>)}</ul>
      {pending && <p role="alert">La réponse est incertaine. Réessayez la même opération : elle ne sera pas comptée deux fois.</p>}
      <div className="review-buttons">
        <button type="button" className="auth-submit" disabled={saving} onClick={save}>
          {saving ? "Enregistrement…" : pending ? "Réessayer la même opération" : "Confirmer l’opération"}
        </button>
        {!pending && <button type="button" className="admin-nav-link" disabled={saving} onClick={() => setReview(null)}>Revenir au formulaire</button>}
      </div>
    </div> : <form className="auth-form" onSubmit={(event) => {
      event.preventDefault();
      if (invalid || items.length < 2 || items.some((item) => item.input === "") || !reason.trim()) return;
      setNotice(null);
      setReview({ kind, reason, requestKey: crypto.randomUUID(), items: items.map((item) => ({
        productId: item.id, quantity: Number(item.input), stockVersion: item.stock_version,
      })) });
    }}>
      <label>Type d’opération de stock<select value={kind} onChange={(event) => {
        setKind(event.target.value);
        setItems(items.map((item) => ({ ...item, input: "" })));
      }}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Ajouter un produit au lot<select value="" disabled={!candidates?.length || items.length >= 50} onChange={(event) => {
        const product = candidates.find((candidate) => String(candidate.id) === event.target.value);
        if (product) setItems([...items, { ...product, input: "" }]);
      }}>
        <option value="">{candidates?.length === 0 ? "Aucun produit à ajouter" : "Choisir un produit"}</option>
        {candidates?.map((product) => <option key={product.id} value={product.id}>{product.name}{product.reference ? ` · ${product.reference}` : ""}</option>)}
      </select></label>
      {items.map((item) => <div key={item.id} className="service-row">
        <label>{item.name} · {kind === "count" ? "Quantité comptée" : "Quantité du mouvement"}
          <input type="number" min={kind === "count" ? 0 : 1} max={1000000} step="1" required value={item.input}
            onChange={(event) => setItems(items.map((line) => line.id === item.id ? { ...line, input: event.target.value } : line))} />
          <small>Stock affiché : {item.quantity}{item.input !== "" ? ` · Après : ${after(item)}` : ""}</small>
        </label>
        <button type="button" className="admin-nav-link" aria-label={`Retirer ${item.name}`}
          onClick={() => setItems(items.filter((line) => line.id !== item.id))}>Retirer</button>
      </div>)}
      {invalid && <p role="alert">Le stock après l’opération doit être compris entre 0 et 1 000 000 unités pour chaque produit.</p>}
      <label>Motif du lot<input required maxLength={255} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
      <div className="review-buttons">
        <button type="submit" className="auth-submit" disabled={items.length < 2 || invalid}>Vérifier le lot</button>
        <button type="button" className="admin-nav-link" onClick={onClose}>Fermer le formulaire</button>
      </div>
    </form>}
  </>;
}
