import { useEffect, useState } from "react";
import { apiRequest, apiUrl, appointmentDate, priceLabel } from "./api-client.js";

const emptyProduct = { name: "", reference: "", category: "", price: 0, threshold: 0, maximum: "", isActive: true };
const numericValue = (value) => value === "" ? "" : Number(value);

export default function Inventory({ csrfToken }) {
  const [filters, setFilters] = useState({ q: "", category: "", stock: "all", includeArchived: "0" });
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [editing, setEditing] = useState(emptyProduct);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const query = new URLSearchParams(filters).toString();

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setResult(null);
    apiRequest(`professional-products.php?${query}&page=${page}`, { signal: controller.signal })
      .then(setResult)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [query, page, refresh]);

  function filter(changes) {
    setFilters((current) => ({ ...current, ...changes }));
    setPage(1);
  }
  function edit(product) {
    setEditing({
      id: product.id, name: product.name, reference: product.reference,
      category: product.category,
      price: Number(product.price_dzd), threshold: Number(product.low_stock_threshold),
      maximum: product.max_stock_quantity == null ? "" : Number(product.max_stock_quantity),
      isActive: Number(product.is_active) === 1,
    });
    setNotice(null);
  }
  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setNotice(null);
    try {
      const saved = await apiRequest("professional-products.php", {
        csrfToken, body: { ...editing, maximum: editing.maximum === "" ? null : editing.maximum },
      });
      setEditing(emptyProduct);
      setSelectedId(saved.productId);
      setRefresh((value) => value + 1);
      setNotice({ kind: "success", text: "Produit enregistré. Pour modifier sa quantité, enregistrez une entrée ou une sortie ci-dessous." });
    } catch (cause) { setNotice({ kind: "error", text: cause.message }); }
    finally { setSaving(false); }
  }

  return (
    <>
      <section className="client-card">
        <h2>Produits et stocks</h2>
        <p>Suivez vos produits à l’unité. Les entrées et sorties sont manuelles : aucune vente ni aucun encaissement n’est enregistré dans ce module.</p>
        {result && <p role="status">Dans le salon : <strong>{result.lowStockCount}</strong> produit(s) actif(s) au seuil d’alerte ou en dessous · <strong>{result.overStockCount}</strong> au-dessus du maximum.</p>}
        <form className="booking-toolbar" onSubmit={(event) => {
          event.preventDefault();
          const fields = new FormData(event.currentTarget);
          filter({ q: fields.get("q").trim(), category: fields.get("category").trim() });
        }}>
          <label>Nom ou référence<input name="q" maxLength={180} placeholder="Rechercher un produit" /></label>
          <label>Catégorie exacte<input name="category" maxLength={80} placeholder="Toutes les catégories" /></label>
          <button type="submit" className="admin-nav-link">Rechercher</button>
          <label>Stock<select value={filters.stock} onChange={(event) => filter({ stock: event.target.value })}>
            <option value="all">Tous les stocks</option><option value="low">Stock bas uniquement</option>
            <option value="over">Au-dessus du maximum</option>
          </select></label>
          <label>Produits<select value={filters.includeArchived} onChange={(event) => filter({ includeArchived: event.target.value })}>
            <option value="0">Actifs</option><option value="1">Actifs et archivés</option>
          </select></label>
          <button type="button" className="admin-nav-link" onClick={() => setRefresh((value) => value + 1)}>Actualiser</button>
          <a className="admin-nav-link" href={apiUrl(`professional-products.php?${query}&format=csv`)}>Exporter les stocks (CSV)</a>
        </form>
        <p className="field-hint">L’export reprend tous les produits correspondant aux filtres, sur toutes les pages. Ce n’est pas un export comptable.</p>
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {!result && !error && <p role="status">Chargement des produits…</p>}
        {result?.products.length === 0 && <p>Aucun produit pour ces filtres.</p>}
        <div className="service-list">
          {result?.products.map((product) => (
            <article className="service-row" key={product.id}>
              <span><strong>{product.name}</strong>{product.reference && <> · {product.reference}</>}<br />
                {product.category && <>{product.category}<br /></>}
                {priceLabel(product.price_dzd)} · Stock : <strong>{product.quantity}</strong> · Seuil : {product.low_stock_threshold}
                {product.max_stock_quantity != null && <> · Maximum : {product.max_stock_quantity}</>}<br />
                {!Number(product.is_active) ? "Archivé" : Number(product.quantity) <= Number(product.low_stock_threshold)
                  ? <span className="stock-warning">Stock bas</span>
                  : product.max_stock_quantity != null && Number(product.quantity) > Number(product.max_stock_quantity)
                    ? <span className="stock-warning">Au-dessus du maximum</span> : "En stock"}
              </span>
              <div className="review-buttons">
                <button type="button" className="admin-nav-link" disabled={saving} onClick={() => edit(product)}>Modifier</button>
                <button type="button" className="admin-nav-link" aria-pressed={selectedId === product.id} onClick={() => setSelectedId(product.id)}>Mouvements et historique</button>
              </div>
            </article>
          ))}
        </div>
        {result && <nav className="pagination" aria-label="Pages des produits">
          {page > 1 && <button className="admin-nav-link" type="button" onClick={() => setPage(page - 1)}>Précédent</button>}
          {result.hasMore && <button className="admin-nav-link" type="button" onClick={() => setPage(page + 1)}>Suivant</button>}
        </nav>}
      </section>
      <section className="client-card">
        <h2>{editing.id ? "Modifier un produit" : "Ajouter un produit"}</h2>
        <p className="field-hint">Un nouveau produit commence à zéro. L’archivage conserve les quantités et l’historique ; réactivez le produit pour enregistrer de nouveaux mouvements.</p>
        {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
        <form className="auth-form" onSubmit={submit}>
          <fieldset disabled={saving} className="form-fieldset">
            <label>Nom du produit<input required maxLength={180} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
            <label>Référence (facultative)<input maxLength={80} value={editing.reference} onChange={(event) => setEditing({ ...editing, reference: event.target.value })} /></label>
            <label>Catégorie (facultative)<input maxLength={80} value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} /></label>
            <div className="auth-grid">
              <label>Prix de vente unitaire (DA)<input required type="number" min={0} max={10000000} step={1} value={editing.price} onChange={(event) => setEditing({ ...editing, price: numericValue(event.target.value) })} /></label>
              <label>Seuil d’alerte (unités)<input required type="number" min={0} max={1000000} step={1} value={editing.threshold} onChange={(event) => setEditing({ ...editing, threshold: numericValue(event.target.value) })} /></label>
              <label>Stock maximum (facultatif)<input type="number" min={editing.threshold || 0} max={1000000} step={1} value={editing.maximum} onChange={(event) => setEditing({ ...editing, maximum: numericValue(event.target.value) })} /></label>
            </div>
            <p className="field-hint">Le maximum déclenche une alerte de surstock sans bloquer les entrées.</p>
            <label className="checkbox-label"><input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />Produit actif</label>
            <div className="review-buttons">
              <button type="submit" className="auth-submit">{saving ? "Enregistrement…" : "Enregistrer le produit"}</button>
              {editing.id && <button type="button" className="admin-nav-link" onClick={() => setEditing(emptyProduct)}>Annuler l’édition</button>}
            </div>
          </fieldset>
        </form>
      </section>
      {selectedId && <StockMovements key={selectedId} productId={selectedId} csrfToken={csrfToken} refresh={refresh} onChanged={() => setRefresh((value) => value + 1)} />}
    </>
  );
}

function StockMovements({ productId, csrfToken, refresh, onChanged }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("all");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(null);
  const [direction, setDirection] = useState("in");
  const [countVersion, setCountVersion] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("");
  const count = direction === "count";
  const historyQuery = new URLSearchParams({ productId, filter }).toString();

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setResult(null);
    apiRequest(`professional-stock-movements.php?${historyQuery}&page=${page}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setResult(data); })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    return () => controller.abort();
  }, [historyQuery, page, refresh]);

  async function submit(event) {
    event.preventDefault();
    if (saving || (!pending && count && countVersion !== result.stockVersion)) return;
    const body = pending || { productId, direction, quantity, reason, requestKey: crypto.randomUUID(),
      ...(count ? { stockVersion: countVersion } : {}) };
    setPending(body);
    setSaving(true);
    setNotice(null);
    try {
      const saved = await apiRequest("professional-stock-movements.php", { csrfToken, body });
      setPending(null);
      setDirection("in");
      setQuantity(1);
      setReason("");
      setPage(1);
      onChanged();
      setNotice({ kind: "success", text: saved.message });
    } catch (cause) {
      if (cause.status >= 400 && cause.status < 500) setPending(null);
      if (cause.status === 409 && body.direction === "count") {
        setDirection("in");
        setQuantity(1);
        onChanged();
      }
      setNotice({ kind: "error", text: cause.message });
    } finally { setSaving(false); }
  }
  return (
    <section className="client-card" aria-label="Mouvements de stock">
      <h2>{result ? `Stock : ${result.product.name}` : "Mouvements de stock"}</h2>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {!result && !error && <p role="status">Chargement de l’historique…</p>}
      {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
      {result && <>
        <p>Stock actuel : <strong>{result.product.quantity}</strong> unité(s).</p>
        {(Number(result.product.is_active) === 1 || pending) ? <form className="auth-form" onSubmit={submit}>
          <fieldset className="form-fieldset" disabled={saving || !!pending}>
            <div className="auth-grid">
              <label>Mouvement<select value={direction} onChange={(event) => {
                const next = event.target.value;
                setDirection(next);
                if (next === "count") { setCountVersion(result.stockVersion); setQuantity(""); }
                else if (count) setQuantity(1);
              }}><option value="in">Entrée de stock</option><option value="out">Sortie de stock</option><option value="count">Comptage physique</option></select></label>
              <label>{count ? "Quantité réellement comptée" : "Quantité (unités entières)"}<input required type="number" min={count ? 0 : 1} max={1000000} step={1} value={quantity} onChange={(event) => setQuantity(numericValue(event.target.value))} /></label>
            </div>
            {count && <p className="field-hint">Le comptage rapproche le stock enregistré de la quantité réellement comptée.
              {quantity !== "" && <> Écart : {Number(quantity) - Number(result.product.quantity)} unité(s).</>}</p>}
            <label>Motif obligatoire<input required maxLength={255} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Livraison, utilisation en cabine, casse, correction…" /></label>
          </fieldset>
          {!pending && count && countVersion !== result.stockVersion && <p role="alert">Le stock a changé. Resélectionnez le comptage et recommencez.</p>}
          <button type="submit" className="auth-submit" disabled={saving || (!pending && count && countVersion !== result.stockVersion)}>{saving ? "Enregistrement…" : pending ? "Réessayer le même mouvement" : count ? "Confirmer le comptage" : "Enregistrer le mouvement"}</button>
          {pending && !saving && <p className="field-hint">La réponse est incertaine. Réessayez ce même mouvement : il ne sera pas compté deux fois. Vérifiez l’historique avant de quitter cette page.</p>}
        </form> : <p>Produit archivé : les mouvements restent consultables, mais aucune entrée ou sortie n’est possible.</p>}
        <h3>Historique des mouvements</h3>
        <div className="booking-toolbar">
          <label>Type d’historique<select value={filter} disabled={saving} onChange={(event) => { setFilter(event.target.value); setPage(1); }}>
            <option value="all">Tous les mouvements</option><option value="counts">Comptages physiques</option>
          </select></label>
          <a className="admin-nav-link" href={apiUrl(`professional-stock-movements.php?${historyQuery}&format=csv`)}>Exporter l’historique (CSV)</a>
        </div>
        <p className="field-hint">Horaires d’Algérie. Les mouvements ne sont pas supprimables ; utilisez un mouvement inverse motivé pour corriger une erreur.</p>
        {result.movements.length === 0 && <p>Aucun mouvement enregistré.</p>}
        <div className="service-list">
          {result.movements.map((movement) => <article className="service-row" key={movement.id}>
            <span><strong>{Number(movement.quantity_delta) > 0 ? "+" : ""}{movement.quantity_delta} unité(s)</strong> · Stock après : {movement.quantity_after}<br />
              {!!Number(movement.is_count) && <>Comptage physique · Stock avant : {Number(movement.quantity_after) - Number(movement.quantity_delta)}<br /></>}
              {movement.reason}<br /><small>{appointmentDate(movement.created_at)}</small>
            </span>
          </article>)}
        </div>
        <nav className="pagination" aria-label="Pages des mouvements">
          {page > 1 && <button type="button" className="admin-nav-link" disabled={saving} onClick={() => setPage(page - 1)}>Précédent</button>}
          {result.hasMore && <button type="button" className="admin-nav-link" disabled={saving} onClick={() => setPage(page + 1)}>Suivant</button>}
        </nav>
      </>}
    </section>
  );
}
