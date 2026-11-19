import { useEffect, useId, useState } from "react";
import { apiRequest } from "./api-client.js";

export default function AlgerianCityInput({ name, value, defaultValue = "", onChange, placeholder, maxLength = 100 }) {
  const generatedId = useId();
  const listId = `algerian-cities-${generatedId}`;
  const controlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const [cities, setCities] = useState([]);
  const [error, setError] = useState("");
  const currentValue = controlled ? value : uncontrolledValue;

  useEffect(() => {
    const query = currentValue.trim();
    setError("");
    if (query.length < 2) {
      setCities([]);
      return undefined;
    }
    setCities([]);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      apiRequest(`salons.php?${new URLSearchParams({ view: "cities", q: query })}`, { signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setCities(result.cities); })
        .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [currentValue]);

  function change(event) {
    if (!controlled) setUncontrolledValue(event.target.value);
    onChange?.(event);
  }

  return <>
    <input
      name={name}
      value={controlled ? value : uncontrolledValue}
      onChange={change}
      placeholder={placeholder}
      maxLength={maxLength}
      list={listId}
      autoComplete="address-level2"
      aria-describedby={error ? `${listId}-error` : undefined}
    />
    <datalist id={listId}>{cities.map((city) => <option key={city} value={city} />)}</datalist>
    {error && <small className="city-suggestion-error" id={`${listId}-error`} role="status">Suggestions indisponibles ; vous pouvez saisir la ville manuellement.</small>}
  </>;
}
