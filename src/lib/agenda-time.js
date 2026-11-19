const algerianTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Algiers",
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export function currentTimePosition(now, date, start, end, pixelsPerMinute) {
  const parts = Object.fromEntries(algerianTime.formatToParts(now).map(({ type, value }) => [type, value]));
  if (`${parts.year}-${parts.month}-${parts.day}` !== date) return null;
  const currentMinute = Number(parts.hour) * 60 + Number(parts.minute);
  if (currentMinute < start || currentMinute >= end) return null;
  return (currentMinute - start) * pixelsPerMinute;
}
