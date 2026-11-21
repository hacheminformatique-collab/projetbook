import { useId, useState } from "react";
import communesByWilaya from "./data/algerian-communes.json";
import { getWilayaName } from "./data/algerian-wilayas.js";

const normalize = (value) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/[\s’'-]+/g, " ");
const communes = Object.entries(communesByWilaya).flatMap(([wilaya, cities]) =>
  cities.map(([name, arabic]) => ({ name, wilaya, names: [normalize(name), normalize(arabic)] })),
);
const collator = new Intl.Collator("fr-DZ");
communes.sort((a, b) => collator.compare(a.name, b.name) || a.wilaya.localeCompare(b.wilaya));

export function findCommune(value, wilaya = "") {
  const query = normalize(value);
  const matches = communes.filter((city) => (!wilaya || city.wilaya === wilaya) && city.names.includes(query));
  return matches.length === 1 ? matches[0] : undefined;
}

export default function CommuneSearchInput({ label, name, value, onChange, onSelect, placeholder }) {
  const id = useId();
  const listId = `${id}-communes`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const query = normalize(value);
  const matches = open && query.replace(/[^\p{L}]/gu, "").length >= 3
    ? communes.filter((city) => city.names.some((name) => name.startsWith(query))).slice(0, 10) : [];
  const close = () => { setOpen(false); setActive(-1); };
  function choose(city) {
    onSelect(city);
    close();
  }

  return <div className="commune-search">
    <input role="combobox" aria-autocomplete="list" aria-label={label} aria-expanded={matches.length > 0}
      aria-controls={matches.length ? listId : undefined}
      aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
      name={name} value={value} placeholder={placeholder} maxLength={100} autoComplete="off"
      onFocus={() => setOpen(true)} onBlur={close}
      onChange={(event) => { onChange(event.target.value); setOpen(true); setActive(-1); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") close();
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && matches.length) {
          event.preventDefault();
          setActive((index) => index < 0 ? (event.key === "ArrowDown" ? 0 : matches.length - 1)
            : (index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
        }
        if (event.key === "Enter" && matches[active]) {
          event.preventDefault();
          choose(matches[active]);
        }
      }}
    />
    {matches.length > 0 && <ul id={listId} className="commune-options" role="listbox" aria-label="Villes et wilayas">
      {matches.map((city, index) => <li key={`${city.wilaya}:${city.name}:${index}`} id={`${listId}-${index}`} role="option"
        aria-selected={index === active} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(city)}>
        <span>{city.name}</span><small>{getWilayaName(city.wilaya)} ({city.wilaya})</small>
      </li>)}
    </ul>}
  </div>;
}
