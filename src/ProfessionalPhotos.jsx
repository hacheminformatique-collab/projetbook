import { useEffect, useMemo, useState } from "react";
import { apiRequest, apiUrl } from "./api-client.js";

const statusNames = { pending: "En attente", approved: "Validée", rejected: "Refusée" };
const photoFilters = [
  ["all", "Toutes"], ["approved", "Validées"], ["pending", "En attente"], ["rejected", "Refusées"],
];

export default function ProfessionalPhotos({ csrfToken }) {
  const [photos, setPhotos] = useState(null);
  const [tab, setTab] = useState("all");
  const [notice, setNotice] = useState(null);
  const [working, setWorking] = useState(false);
  const activePhotos = useMemo(() => photos?.filter((photo) => photo.status !== "rejected") || [], [photos]);
  const presentationPhoto = activePhotos.find((photo) => photo.status === "approved");
  const presentationPosition = presentationPhoto ? activePhotos.indexOf(presentationPhoto) + 1 : null;
  const count = photos?.length ?? 0;

  async function load(signal) {
    const result = await apiRequest("professional-salon-photos.php", { signal });
    setPhotos(result.photos);
    setTab("all");
  }

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .catch((cause) => { if (!controller.signal.aborted) setNotice({ kind: "error", text: cause.message }); });
    return () => controller.abort();
  }, []);

  async function upload(event) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (files.length === 0) return;
    if (files.length > 4 - (photos?.length || 0)) {
      setNotice({ kind: "error", text: `Il ne reste que ${4 - (photos?.length || 0)} emplacement(s) photo.` });
      input.value = "";
      return;
    }
    setWorking(true);
    setNotice(null);
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.set("action", "upload");
        formData.set("photo", file);
        const response = await fetch(apiUrl("professional-salon-photos.php"), {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-CSRF-Token": csrfToken },
          body: formData,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "L’import de la photo a échoué.");
        setPhotos(result.photos);
      }
      setNotice({ kind: "success", text: "Photos importées. Elles seront visibles après validation, si votre fiche est publiée." });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      input.value = "";
      setWorking(false);
    }
  }

  async function remove(photo) {
    if (!window.confirm("Supprimer définitivement cette photo ?")) return;
    setWorking(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-salon-photos.php", {
        csrfToken, body: { action: "delete", photoId: Number(photo.id) },
      });
      setPhotos(result.photos);
      setNotice({ kind: "success", text: "La photo a été supprimée." });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      setWorking(false);
    }
  }

  async function move(photo, offset, chooseCover = false) {
    const index = activePhotos.findIndex((item) => Number(item.id) === Number(photo.id));
    const target = index + offset;
    if (index < 0 || target < 0 || target >= activePhotos.length) return;
    const photoIds = activePhotos.map((item) => Number(item.id));
    [photoIds[index], photoIds[target]] = [photoIds[target], photoIds[index]];
    setWorking(true);
    setNotice(null);
    try {
      const result = await apiRequest("professional-salon-photos.php", {
        csrfToken, body: { action: "reorder", photoIds },
      });
      setPhotos(result.photos);
      if (chooseCover) setNotice({ kind: "success", text: "La photo de couverture a été mise à jour." });
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      setWorking(false);
    }
  }

  const shownPhotos = photos?.filter((photo) => tab === "all" || photo.status === tab) ?? [];
  return <section className="client-card pro-photo-management">
    <div className="client-directory-header">
      <div><h2>Gestion des photos</h2><p>Ajoutez votre logo ou une photo de l’intérieur ou de l’extérieur du salon.</p></div>
      <label className="admin-nav-link photo-upload">
        Importer des photos
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={working || photos === null || count >= 4} onChange={upload} />
      </label>
    </div>
    <p className="field-hint">{photos && `${count} / 4 emplacements utilisés · `}JPEG, PNG ou WebP · 2 Mo et 8 mégapixels maximum par photo.</p>
    {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    {photos === null && !notice && <p role="status">Chargement des photos…</p>}
    {photos && <>
    <div className="photo-cover-summary">
      {presentationPhoto && <img src={apiUrl(`salon-photo.php?id=${encodeURIComponent(presentationPhoto.id)}`)} alt="" />}
      <div>
        <strong>{presentationPhoto ? `Couverture actuelle : photo ${presentationPosition}` : "Aucune photo de couverture"}</strong>
        <p>{presentationPhoto ? "Elle illustre votre carte dans l’annuaire et apparaît en premier sur votre fiche, si elle est publiée."
          : "La première photo validée devient la couverture. Sans photo validée, aucune image n’apparaît sur votre carte."}</p>
      </div>
    </div>
    <div className="photo-tabs" role="group" aria-label="Filtrer les photos par statut">
      {photoFilters.map(([value, label]) => <button type="button" key={value} aria-pressed={tab === value} onClick={() => setTab(value)}>
        {label} ({value === "all" ? count : photos.filter((photo) => photo.status === value).length})
      </button>)}
    </div>
    {shownPhotos.length === 0 && <p>{tab === "all" ? "Aucune photo importée." : "Aucune photo avec ce statut."}</p>}
    <div className="salon-photo-grid">
      {shownPhotos.map((photo) => {
        const index = activePhotos.findIndex((item) => Number(item.id) === Number(photo.id));
        const position = index >= 0 ? index + 1 : Number(photo.position);
        const isCover = photo.id === presentationPhoto?.id;
        return <article className="salon-photo-card" key={photo.id}>
          <div className="salon-photo-preview">
            <img src={apiUrl(`salon-photo.php?id=${encodeURIComponent(photo.id)}`)} alt={`Photo ${position} de l’établissement`} />
            <span className={`photo-status photo-status-${photo.status}`}>{statusNames[photo.status]}</span>
          </div>
          <div className="salon-photo-actions">
            <span>{isCover ? <strong className="photo-cover-label">Couverture</strong>
              : photo.status === "approved" ? `Position ${position}` : "Non visible par les clients"}</span>
            <div>
              {photo.status === "approved" && !isCover && <button className="admin-nav-link" type="button" disabled={working} onClick={() => move(photo, -index, true)}>Choisir en couverture</button>}
              {photo.status !== "rejected" && <>
                <button className="admin-nav-link" type="button" aria-label={`Monter la photo ${position}`} disabled={working || index <= 0} onClick={() => move(photo, -1)}>↑</button>
                <button className="admin-nav-link" type="button" aria-label={`Descendre la photo ${position}`} disabled={working || index === activePhotos.length - 1} onClick={() => move(photo, 1)}>↓</button>
              </>}
              <button className="admin-nav-link" type="button" disabled={working} onClick={() => remove(photo)}>Supprimer</button>
            </div>
          </div>
        </article>;
      })}
    </div>
    </>}
  </section>;
}
