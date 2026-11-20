#!/usr/bin/env node
import assert from "node:assert/strict";
import { createBookingCalendarEvent } from "../src/lib/booking-calendar.js";

const appointment = {
  appointmentId: 55,
  salonId: 3,
  salonName: "Salon; zen",
  salonAddress: "10 rue de l, Sétif",
  serviceName: "Coupe, couleur",
  date: "2026-11-19",
  time: "10:30",
  durationMinutes: 30,
  staffName: "Sonia",
  priceLabel: "1 000 DA",
};
const calendar = createBookingCalendarEvent(appointment);
const unfolded = calendar.replace(/\r\n[ \t]/g, "");

assert.match(unfolded, /BEGIN:VCALENDAR\r\n/);
assert.match(unfolded, /UID:appointment-55-salon-3@bookili\.com\r\n/);
assert.match(unfolded, /DTSTART:20261119T093000Z\r\n/);
assert.match(unfolded, /DTEND:20261119T100000Z\r\n/);
assert.match(unfolded, /SUMMARY:Coupe\\, couleur - Salon\\; zen\r\n/);
assert.match(unfolded, /LOCATION:10 rue de l\\, Sétif\r\n/);
assert.match(unfolded, /DESCRIPTION:Prestation : Coupe\\, couleur\\nCollaborateur : Sonia\\nTarif : 1 000 DA\\, paiement sur place\r\n/);
assert.match(unfolded, /STATUS:CONFIRMED\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n$/);

const longCalendar = createBookingCalendarEvent({ ...appointment, salonName: "é".repeat(100) });
assert.ok(longCalendar.split("\r\n").filter(Boolean).every((line) => Buffer.byteLength(line, "utf8") <= 75));
assert.throws(() => createBookingCalendarEvent({ ...appointment, date: "2026-02-30" }), RangeError);
assert.throws(() => createBookingCalendarEvent({ ...appointment, time: "25:00" }), RangeError);

console.log("Booking calendar event checks passed.");
