import { useEffect, useRef, useState } from "react";
import { apiRequest, appointmentDate } from "./api-client.js";

const endpoint = "professional-stock-orders.php";
const statusLabel = { open: "À recevoir", partial: "Partiellement reçue", received: "Reçue", cancelled: "Reste annulé" };

function useOrderData(path, revision) {
  const [state, setState] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    apiRequest(path, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) setState({ data }); })
      .catch((error) => { if (!controller.signal.aborted) setState({ error: error.message }); });
    return () => controller.abort();
  }, [path, revision]);
  return state;
}

function useOrderSave(csrfToken, onSaved) {
  const last = useRef(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(payload) {
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      const signature = JSON.stringify(payload);
      if (last.current?.signature !== signature) last.current = { signature, key: crypto.randomUUID() };
      const response = await apiRequest(endpoint, { csrfToken, body: { ...payload, requestKey: last.current.key } });
      last.current = null;
      onSaved(response.orderId, payload.action);
    } catch (cause) { setError(cause.message); }
    finally { setSaving(false); }
  }
  return { save, saving, error };
}

export default function StockOrders({ csrfToken, suppliers, onStockChanged }) {
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const { data, error } = useOrderData(`${endpoint}?page=${page}`, revision);
  function saved(id, message) {
    setSelected(id);
    setRevision((value) => value + 1);
    setNotice(message);
  }
  return <section className="client-card" aria-label="Commandes fournisseurs">
    <h2>Commandes fournisseurs</h2>
    <p>Enregistrez une commande passée au fournisseur. Seules les quantités réceptionnées entrent en stock ; aucun e-mail ni paiement n’est déclenché.</p>
    {notice && <p role="status">{notice}</p>}
    {!creating && <button type="button" className="admin-nav-link" onClick={() => { setNotice(""); setCreating(true); }}>Nouvelle commande</button>}
    {creating && <OrderCreate csrfToken={csrfToken} suppliers={suppliers}
      onClose={() => setCreating(false)} onSaved={(id) => {
        setCreating(false);
        setPage(1);
        saved(id, "Commande enregistrée.");
      }} />}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="admin-nav-link" onClick={() => {
      setSelected(null);
      setRevision((value) => value + 1);
    }}>Actualiser la liste</button>
    {!data && !error && <p role="status">Chargement des commandes…</p>}
    {data?.orders.length === 0 && <p>Aucune commande sur cette page.</p>}
    <div className="service-list">{data?.orders.map((order) => <article className="service-row" key={order.id}>
      <span><strong>Commande n° {order.id} · {order.supplier_name}</strong><br />
        {order.reference && <>{order.reference} · </>}{appointmentDate(order.created_at)} · {statusLabel[order.status]}</span>
      <button type="button" className="admin-nav-link" aria-pressed={selected === order.id}
        onClick={() => { setNotice(""); setSelected(order.id); }}>Voir la commande n° {order.id}</button>
    </article>)}</div>
    {data && <nav className="pagination" aria-label="Pages des commandes">
      {page > 1 && <button type="button" className="admin-nav-link" onClick={() => setPage(page - 1)}>Précédent</button>}
      {data.hasMore && <button type="button" className="admin-nav-link" onClick={() => setPage(page + 1)}>Suivant</button>}
    </nav>}
    {selected !== null && <OrderDetail key={`${selected}-${revision}`} id={selected} csrfToken={csrfToken}
      onSaved={(id, action) => {
        if (action === "receive") onStockChanged();
        saved(id, action === "receive" ? "Réception enregistrée et stock mis à jour." : "Reste à recevoir annulé.");
      }} />}
  </section>;
}

function OrderCreate({ csrfToken, suppliers, onSaved, onClose }) {
  const [supplierId, setSupplierId] = useState("");
  const [reference, setReference] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const { data, error: searchError } = useOrderData(`professional-products.php?${new URLSearchParams({ q: search })}`, 0);
  const { save, saving, error } = useOrderSave(csrfToken, onSaved);
  const activeSuppliers = suppliers?.filter((supplier) => Number(supplier.is_active));
  const candidates = data?.products.filter((product) => !items.some((item) => item.id === product.id));
  return <>
    <h3>Nouvelle commande fournisseur</h3>
    <form className="booking-toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
      <label>Rechercher un produit à commander<input value={query} maxLength={180} onChange={(event) => setQuery(event.target.value)} /></label>
      <button type="submit" className="admin-nav-link">Chercher</button>
    </form>
    {searchError && <p role="alert">{searchError}</p>}
    {!data && !searchError && <p role="status">Recherche des produits…</p>}
    {data?.hasMore && <p>Affinez la recherche si le produit ne figure pas dans les 50 premiers résultats.</p>}
    {activeSuppliers?.length === 0 && <p>Ajoutez ou réactivez un fournisseur avant de créer une commande.</p>}
    {error && <p role="alert">{error}</p>}
    <form className="auth-form" onSubmit={(event) => {
      event.preventDefault();
      save({ action: "create", supplierId, reference, items: items.map((item) => ({ productId: item.id, quantity: Number(item.quantity) })) });
    }}>
      <fieldset className="form-fieldset" disabled={saving}>
        <label>Fournisseur de la commande<select value={supplierId} required onChange={(event) => setSupplierId(event.target.value)}>
          <option value="">Choisir un fournisseur</option>
          {activeSuppliers?.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
        </select></label>
        <label>Référence de commande (facultative)<input maxLength={80} value={reference} onChange={(event) => setReference(event.target.value)} /></label>
        <label>Ajouter un produit à la commande<select value="" disabled={!candidates?.length || items.length >= 50} onChange={(event) => {
          const product = candidates.find((candidate) => String(candidate.id) === event.target.value);
          if (product) setItems([...items, { id: product.id, name: product.name, quantity: 1 }]);
        }}>
          <option value="">{candidates?.length === 0 ? "Aucun produit à ajouter" : "Choisir un produit"}</option>
          {candidates?.map((product) => <option key={product.id} value={product.id}>{product.name}{product.reference ? ` · ${product.reference}` : ""}</option>)}
        </select></label>
        {items.map((item) => <div key={item.id} className="service-row">
          <label>{item.name} · Quantité commandée<input required type="number" min="1" max="1000000" step="1" value={item.quantity}
            onChange={(event) => setItems(items.map((line) => line.id === item.id ? { ...line, quantity: event.target.value } : line))} /></label>
          <button type="button" className="admin-nav-link" aria-label={`Retirer ${item.name}`} onClick={() => setItems(items.filter((line) => line.id !== item.id))}>Retirer</button>
        </div>)}
        <div className="review-buttons">
          <button type="submit" className="auth-submit" disabled={!supplierId || !items.length}>Enregistrer la commande</button>
          <button type="button" className="admin-nav-link" onClick={onClose}>Fermer le formulaire</button>
        </div>
      </fieldset>
    </form>
  </>;
}

function OrderDetail({ id, csrfToken, onSaved }) {
  const [quantities, setQuantities] = useState({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { data, error: loadError } = useOrderData(`${endpoint}?orderId=${id}`, 0);
  const { save, saving, error } = useOrderSave(csrfToken, onSaved);
  if (loadError) return <p role="alert">{loadError}</p>;
  if (!data) return <p role="status">Chargement de la commande…</p>;
  const { order } = data;
  const open = ["open", "partial"].includes(order.status);
  const items = order.items.filter((item) => Number(quantities[item.product_id]) > 0)
    .map((item) => ({ productId: item.product_id, quantity: Number(quantities[item.product_id]) }));
  return <form className="auth-form" onSubmit={(event) => {
    event.preventDefault();
    if (open && !confirmCancel && items.length) save({ action: "receive", orderId: id, items });
  }}>
    <h3>Commande n° {id} · {order.supplier_name}</h3>
    <p>{statusLabel[order.status]}</p>
    {error && <p role="alert">{error}</p>}
    <fieldset className="form-fieldset" disabled={saving}>
      {order.items.map((item) => {
        const remaining = Number(item.ordered_quantity) - Number(item.received_quantity);
        return <div key={item.product_id}>
          <strong>{item.product_name}</strong>
          <p>{item.received_quantity} reçue(s) sur {item.ordered_quantity} commandée(s){order.status === "cancelled" && remaining > 0 ? ` · ${remaining} annulée(s)` : ""}</p>
          {open && !confirmCancel && remaining > 0 && <label>Quantité reçue maintenant · {item.product_name}
            <input type="number" min="0" max={remaining} step="1" value={quantities[item.product_id] ?? ""}
              onChange={(event) => setQuantities({ ...quantities, [item.product_id]: event.target.value })} /></label>}
        </div>;
      })}
      {open && (confirmCancel ? <>
        <p>Annuler le reste à recevoir ? Les quantités déjà réceptionnées restent en stock.</p>
        <div className="review-buttons">
          <button type="button" className="admin-nav-link" onClick={() => save({ action: "cancel", orderId: id })}>Confirmer l’annulation du reste</button>
          <button type="button" className="admin-nav-link" onClick={() => setConfirmCancel(false)}>Revenir à la réception</button>
        </div>
      </> : <div className="review-buttons">
        <button type="submit" className="auth-submit" disabled={!items.length}>Enregistrer la réception</button>
        <button type="button" className="admin-nav-link" onClick={() => setConfirmCancel(true)}>Annuler le reste à recevoir</button>
      </div>)}
    </fieldset>
  </form>;
}
