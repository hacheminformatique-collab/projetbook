import { useEffect, useMemo, useState } from "react";
import { apiRequest, apiUrl } from "./api-client.js";

const statusNames = { pending: "En validation", approved: "Validée", rejected: "Refusée" };

export default function ProfessionalPhotos({ csrfToken }) {
  const [photos, setPhotos] = useState(null);
  const [tab, setTab] = useState("active");
  const [notice, setNotice] = useState(null);
  const [working, setWorking] = useState(false);
  const activePhotos = useMemo(() => photos?.filter((photo) => photo.status !== "rejected") || [], [photos]);
  const rejectedPhotos = useMemo(() => photos?.filter((photo) => photo.status === "rejected") || [], [photos]);
  const presentationPhoto = activePhotos.find((photo) => photo.status === "approved");

  async function load(signal) {
    const result = await apiRequest("professional-salon-photos.php", { signal });
    setPhotos(result.photos);
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
      setTab("active");
      setNotice({ kind: "success", text: "Photo(s) importée(s). Elles seront visibles sur votre page après validation." });
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

  async function move(photo, offset) {
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
    } catch (cause) {
      setNotice({ kind: "error", text: cause.message });
    } finally {
      setWorking(false);
    }
  }

  const shownPhotos = tab === "active" ? activePhotos : rejectedPhotos;
  return <section className="client-card">
    <div className="client-directory-header">
      <div><h2>Image de présentation et photos</h2><p>Ajoutez votre logo ou une photo de l’intérieur ou de l’extérieur du salon.</p></div>
      <label className="admin-nav-link photo-upload">
        Importer des photos
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={working || (photos?.length || 0) >= 4} onChange={upload} />
      </label>
    </div>
    <p className="field-hint">JPEG, PNG ou WebP · 2 Mo maximum par photo · 8 mégapixels maximum · quatre photos maximum.</p>
    <p className="field-hint">La première photo validée illustre votre carte dans les résultats de recherche et apparaît en premier sur votre fiche publique. Utilisez « Présenter » pour la choisir. Les nouvelles images restent privées jusqu’à leur validation par BOOKILI.</p>
    {notice && <p className={`form-message form-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p>}
    <nav className="photo-tabs" aria-label="Statut des photos">
      <button type="button" className={tab === "active" ? "selected" : ""} onClick={() => setTab("active")}>Photos validées et en validation ({activePhotos.length})</button>
      <button type="button" className={tab === "rejected" ? "selected" : ""} onClick={() => setTab("rejected")}>Photos refusées ({rejectedPhotos.length})</button>
    </nav>
    {photos === null && !notice && <p role="status">Chargement des photos…</p>}
    {photos && shownPhotos.length === 0 && <p>Aucune photo dans cette catégorie.</p>}
    <div className="salon-photo-grid">
      {shownPhotos.map((photo) => {
        const index = activePhotos.findIndex((item) => Number(item.id) === Number(photo.id));
        const position = index >= 0 ? index + 1 : Number(photo.position);
        return <article className="salon-photo-card" key={photo.id}>
          <div className="salon-photo-preview">
            <img src={apiUrl(`salon-photo.php?id=${encodeURIComponent(photo.id)}`)} alt={`Photo ${position} de l’établissement`} />
            <span className={`photo-status photo-status-${photo.status}`}>{statusNames[photo.status]}</span>
          </div>
          <div className="salon-photo-actions">
            <span>{photo.id === presentationPhoto?.id ? "Image de présentation" : `Position ${position}`}</span>
            <div>
              {photo.status === "approved" && photo.id !== presentationPhoto?.id && <button className="admin-nav-link" type="button" disabled={working} onClick={() => move(photo, -index)}>Présenter</button>}
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
  </section>;
}
