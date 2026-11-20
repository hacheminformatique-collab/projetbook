function escapeText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/([,;])/g, "\\$1");
}

function foldLine(line) {
  const encoder = new TextEncoder();
  const folded = [];
  let current = "";
  let bytes = 0;
  for (const character of line) {
    const characterBytes = encoder.encode(character).length;
    if (bytes + characterBytes > 75) {
      folded.push(current);
      current = ` ${character}`;
      bytes = characterBytes + 1;
    } else {
      current += character;
      bytes += characterBytes;
    }
  }
  folded.push(current);
  return folded.join("\r\n");
}

function utcTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function createBookingCalendarEvent({
  appointmentId,
  salonId,
  salonName,
  salonAddress,
  serviceName,
  date,
  time,
  durationMinutes,
  staffName,
  priceLabel,
}) {
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date)
    && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
  if (!validDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new RangeError("La date ou l’horaire du rendez-vous est invalide.");
  }
  if (!Number.isSafeInteger(Number(appointmentId)) || Number(appointmentId) < 1
    || !Number.isSafeInteger(Number(salonId)) || Number(salonId) < 1
    || !Number.isSafeInteger(Number(durationMinutes)) || Number(durationMinutes) < 1) {
    throw new RangeError("Les informations du rendez-vous sont invalides.");
  }

  const start = new Date(`${date}T${time}:00+01:00`);
  const end = new Date(start.getTime() + Number(durationMinutes) * 60000);
  const description = [
    `Prestation : ${serviceName}`,
    `Collaborateur : ${staffName}`,
    `Tarif : ${priceLabel}, paiement sur place`,
  ].join("\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//BOOKILI//Rendez-vous//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:appointment-${appointmentId}-salon-${salonId}@bookili.com`,
    `DTSTAMP:${utcTimestamp(new Date())}`,
    `DTSTART:${utcTimestamp(start)}`,
    `DTEND:${utcTimestamp(end)}`,
    `SUMMARY:${escapeText(`${serviceName} - ${salonName}`)}`,
    `LOCATION:${escapeText(salonAddress)}`,
    `DESCRIPTION:${escapeText(description)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
