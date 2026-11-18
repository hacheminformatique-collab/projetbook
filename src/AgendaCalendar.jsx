import { useState } from "react";
import { algerianDate, weekDays } from "./api-client.js";

const monthFormat = new Intl.DateTimeFormat("fr-DZ", { month: "long", year: "numeric", timeZone: "UTC" });
const dayFormat = new Intl.DateTimeFormat("fr-DZ", { dateStyle: "full", timeZone: "UTC" });

export default function AgendaCalendar({ date, onChange }) {
  const [offset, setOffset] = useState(0);
  const month = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() + offset);
  const firstDay = new Date(month);
  firstDay.setUTCDate(1 - (month.getUTCDay() + 6) % 7);
  const today = algerianDate();
  return <section className="agenda-calendar" aria-label="Calendrier de l’agenda">
    <div className="agenda-calendar-header">
      <strong aria-live="polite">{monthFormat.format(month)}</strong>
      <button type="button" aria-label="Mois précédent" onClick={() => setOffset(offset - 1)}>‹</button>
      <button type="button" aria-label="Mois suivant" onClick={() => setOffset(offset + 1)}>›</button>
    </div>
    <div className="agenda-calendar-days">
      {weekDays.map((day) => <abbr key={day} title={day}>{day[0]}</abbr>)}
      {Array.from({ length: 42 }, (_, index) => {
        const day = new Date(firstDay);
        day.setUTCDate(day.getUTCDate() + index);
        const value = day.toISOString().slice(0, 10);
        return <button key={value} type="button" aria-label={dayFormat.format(day)}
          aria-current={value === today ? "date" : undefined} aria-pressed={value === date}
          className={day.getUTCMonth() !== month.getUTCMonth() ? "agenda-other-month" : undefined}
          onClick={() => { setOffset(0); onChange(value); }}>{day.getUTCDate()}</button>;
      })}
    </div>
  </section>;
}
