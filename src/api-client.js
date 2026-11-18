export async function apiRequest(path, { body, csrfToken, signal } = {}) {
  const response = await fetch(`/api/${path}`, {
    credentials: "same-origin",
    signal,
    ...(body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      body: JSON.stringify(body),
    }),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Réponse serveur invalide. Vérifiez le déploiement des fichiers PHP et la configuration cPanel.");
  }
  if (!response.ok) {
    const error = new Error(result.error || "La demande n’a pas abouti.");
    error.status = response.status;
    throw error;
  }
  return result;
}

export function algerianDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type) => parts.find((part) => part.type === type).value;
  const date = new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00+01:00`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export const priceLabel = (price) => `${new Intl.NumberFormat("fr-DZ").format(Number(price))} DA`;
export const appointmentDate = (date) => new Intl.DateTimeFormat("fr-DZ", {
  timeZone: "Africa/Algiers", dateStyle: "long", timeStyle: "short",
}).format(new Date(date.replace(" ", "T") + "+01:00"));

export const serviceCategories = [
  ["coiffeur", "Coiffure"], ["barbier", "Barbier"], ["manucure", "Manucure"],
  ["institut", "Institut de beauté"], ["bien-etre", "Bien-être"],
  ["maquillage", "Maquillage"], ["spa", "Spa"], ["massage", "Massage"],
];
export const weekDays = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
