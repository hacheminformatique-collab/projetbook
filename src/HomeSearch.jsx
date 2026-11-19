import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AlgerianCityInput from "./AlgerianCityInput.jsx";

const icons = {
  location: <><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
  search: <><circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/></>,
  coiffeur: <><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="m8 16 11-13M16 16 5 3"/></>,
  institut: <path d="M12 19C5 19 2 15 2 11c3 0 5 1 7 3M12 19c7 0 10-4 10-8-3 0-5 1-7 3m-3 5C7 14 8 9 12 4c4 5 5 10 0 15Z"/>,
  manucure: <><rect x="5" y="12" width="14" height="10" rx="3"/><path d="M9 12V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v8M9 16v3"/></>,
  barbier: <path d="M12 12c-2-5-7 4-10-2 0 8 7 8 10 4 3 4 10 4 10-4-3 6-8-3-10 2Zm-6 7c1 2 3 3 6 3s5-1 6-3"/>,
  maquillage: <path d="M15 10c-1-3 2-7 7-8 0 5-3 9-6 9L5 22a2 2 0 0 1-3-3l11-11m0 0 3 3"/>,
  more: <><circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/></>,
};

const shortcuts = [
  ["coiffeur", "Coiffure"], ["institut", "Esthétique"], ["manucure", "Ongles"],
  ["barbier", "Barber"], ["maquillage", "Maquillage"], ["more", "Et bien plus"],
];

function Icon({ name }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}

export default function HomeSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");

  function searchLink(category, includeQuery = false) {
    const params = new URLSearchParams();
    const city = location.trim();
    if (city) params.set("ville", city);
    if (includeQuery && query.trim()) params.set("q", query.trim());
    if (category && category !== "more") params.set("categorie", category);
    return `/recherche${params.size ? `?${params}` : ""}${category === "more" ? "#categories" : ""}`;
  }

  return <>
    <form className="search-panel" role="search" onSubmit={(event) => {
      event.preventDefault();
      navigate(searchLink(null, true));
    }}>
      <label className="search-field location-field">
        <Icon name="location" />
        <span className="visually-hidden">Ville en Algérie</span>
        <AlgerianCityInput value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Votre ville" />
      </label>
      <label className="search-field service-field">
        <Icon name="search" />
        <span className="visually-hidden">Nom du salon ou de la prestation</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Coiffure, esthétique, barber, ongles…" maxLength={100} />
      </label>
      <button className="search-button" type="submit">Rechercher</button>
    </form>
    <nav className="hero-shortcuts" aria-label="Rechercher par catégorie">
      {shortcuts.map(([category, label]) => <Link key={category} to={searchLink(category)}><Icon name={category} /><span>{label}</span></Link>)}
    </nav>
  </>;
}
