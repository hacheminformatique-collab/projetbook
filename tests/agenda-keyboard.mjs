#!/usr/bin/env node
// Run after a production build; requires a locally installed Google Chrome.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preview } from "vite";

const server = await preview({ base: "/masalledereception/", preview: { host: "127.0.0.1", port: 0 } });
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "bookili-agenda-keyboard-"));
const chrome = spawn("google-chrome", [
  "--headless", "--no-sandbox", "--disable-dev-shm-usage", "--remote-debugging-pipe",
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });

let id = 0;
let buffer = "";
let sessionId;
const pending = new Map();
function send(method, params = {}, session = sessionId) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Chrome did not respond to ${method}`));
    }, 6000);
    pending.set(requestId, (message) => {
      clearTimeout(timeout);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    chrome.stdio[3].write(`${JSON.stringify({ id: requestId, method, params, sessionId: session })}\0`);
  });
}
chrome.stdio[4].on("data", (chunk) => {
  buffer += chunk.toString();
  const messages = buffer.split("\0");
  buffer = messages.pop();
  for (const raw of messages) {
    const message = JSON.parse(raw);
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  }
});
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Not found: ${expression}`);
}
async function key(value) {
  const windowsVirtualKeyCode = { Enter: 13, Escape: 27, ArrowUp: 38, ArrowDown: 40 }[value];
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: value, code: value, windowsVirtualKeyCode });
  if (value === "Enter") await send("Input.dispatchKeyEvent", { type: "char", key: value, code: value, text: "\r", windowsVirtualKeyCode });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: value, code: value, windowsVirtualKeyCode });
}

try {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  ({ sessionId } = await send("Target.attachToTarget", { targetId, flatten: true }));
  await send("Page.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `
    const OriginalDate = Date;
    window.Date = class extends OriginalDate {
      constructor(...args) { super(...(args.length ? args : ["2026-11-19T09:30:45Z"])); }
      static now() { return new OriginalDate("2026-11-19T09:30:45Z").valueOf(); }
    };
    const originalFetch = window.fetch;
    let clientNote = "Préférence salon";
    window.appointmentMutations = 0;
    window.cashRequests = [];
    window.staffSaveBody = null;
    window.agendaPauses = false;
    window.clientBookingTest = location.pathname.startsWith("/masalledereception/salons/");
    window.clientBookingGuest = new URLSearchParams(location.search).get("bookingTest") === "guest";
    window.multiGuestTest = new URLSearchParams(location.search).get("multiTest") === "1";
    window.multiBookingTest = new URLSearchParams(location.search).get("multiTest") === "booking";
    if (window.multiGuestTest || window.multiBookingTest) {
      window.extraServices = Array.from({ length: 6 }, (_, index) => ({
        id: index + 2, name: window.multiBookingTest && index === 5 ? "Prestation " + "x".repeat(150) : "Prestation " + (index + 2),
        category: "coiffeur", duration_minutes: 15, price_dzd: 500,
      }));
    }
    window.loginPayload = null;
    window.bookingConfirmationTest = false;
    window.bookingPayload = null;
    window.clientAppointments = [
      { id: 55, version: 1, salon_id: 1, service_id: 1, service_count: 1, services: [{ id: 1, name: "Coupe test", duration_minutes: 45, price_dzd: 2500 }], staff_id: 1, status: "confirmed", starts_at: "2026-11-20 10:30:00", ends_at: "2026-11-20 11:15:00", service_name: "Coupe test", price_dzd: 2500, salon_name: "Salon test", address: "10 rue de test", city: "Sétif", salon_phone: "0550123456", staff_name: "Sonia" },
      { id: 56, salon_id: 1, service_id: 1, service_count: 2, services: [
        { id: 1, name: "Coupe annulée", duration_minutes: 30, price_dzd: 1000 },
        { id: 2, name: "Soin annulé", duration_minutes: 45, price_dzd: 1500 },
      ], status: "cancelled", starts_at: "2026-11-20 12:00:00", ends_at: "2026-11-20 13:15:00", service_name: "Coupe annulée + Soin annulé", price_dzd: 2500, salon_name: "Salon test", address: "10 rue de test", city: "Sétif", salon_phone: "0550123456", staff_name: null },
    ];
    window.calendarFiles = [];
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => window.calendarFiles.push({ type: blob.type, text }));
      return "blob:bookili-test";
    };
    URL.revokeObjectURL = () => {};
    let appointmentSaleId = null;
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      let data;
      if (url.pathname.endsWith("/api/csrf.php")) {
        data = { csrfToken: "test" };
      } else if (url.pathname.endsWith("/api/login.php")) {
        window.loginPayload = JSON.parse(options.body);
        window.clientBookingGuest = false;
        window.clientBookingTest = true;
        data = { account: { role: "client" }, csrfToken: "test" };
      } else if (url.pathname.endsWith("/api/session.php")) {
        data = window.clientBookingGuest
          ? { authenticated: false }
          : { authenticated: true, account: { role: window.clientBookingTest ? "client" : "professional" }, csrfToken: "test" };
      } else if (url.pathname.endsWith("/api/client-profile.php")) {
        data = { email: "client@example.test", profile: { first_name: "Test", last_name: "Client", phone_number: "0550123456", date_of_birth: "1990-01-01", marketing_consent: 0 } };
      } else if (url.pathname.endsWith("/api/salons.php")) {
        if (url.searchParams.has("id")) {
          data = {
            salon: {
              id: 1, name: "Salon test", city: "Sétif", wilaya_code: "19",
              address: "10 rue de test", phone_number: "0550123456", booking_message: "",
            },
            services: [
              ...(window.hideService ? [] : [{ id: 1, name: "Coupe test", category: "coiffeur", duration_minutes: 30, price_dzd: 1000 }]),
              ...(window.extraServices || []),
            ],
            hours: [], profileEntries: [], photos: [],
          };
        } else if (url.searchParams.get("view") === "cities") {
          window.citySuggestionQuery = url.searchParams.get("q");
          data = { cities: ["Sétif", "Setif", "Oran"].filter((city) => city.toLowerCase().startsWith(window.citySuggestionQuery.toLowerCase())) };
        } else {
          window.directoryQuery = Object.fromEntries(url.searchParams);
          data = { salons: [], hasMore: window.directoryQuery.tri === "prix" && !window.directoryQuery.page };
        }
      } else if (url.pathname.endsWith("/api/professional-salon.php")) {
        data = { salon: { id: 1, name: "Salon test", city: "Sétif", wilaya_code: "19", is_public: 1 }, hours: [] };
      } else if (url.pathname.endsWith("/api/professional-staff.php")) {
        const hours = Array.from({ length: 7 }, (_, index) => ({
          weekday: index + 1, opens_at: "09:00:00", closes_at: "18:00:00",
          pause_starts_at: index === 0 ? "12:00:00" : null,
          pause_ends_at: index === 0 ? "13:00:00" : null,
        }));
        if (options?.method === "POST") {
          window.staffSaveBody = JSON.parse(options.body);
          data = { staff: [{ id: 1, name: "Sonia", is_active: 1, hours }], message: "Horaires enregistrés." };
        } else data = { staff: [{ id: 1, name: "Sonia", is_active: 1, hours }] };
      } else if (url.pathname.endsWith("/api/professional-agenda.php")) {
        const date = url.searchParams.get("date");
        data = {
          salonId: 1, date, hours: {
            opens_at: "09:00:00", closes_at: "18:00:00",
            pause_starts_at: window.agendaPauses ? "13:00:00" : null,
            pause_ends_at: window.agendaPauses ? "13:45:00" : null,
          }, closed: false,
          staff: [
            { id: 1, name: "Sonia", is_active: 1, opens_at: "09:00:00", closes_at: "18:00:00", pause_starts_at: window.agendaPauses ? "14:00:00" : null, pause_ends_at: window.agendaPauses ? "14:30:00" : null },
            { id: 2, name: "Lina", is_active: 1, opens_at: "09:00:00", closes_at: "18:00:00" },
          ],
          staffAbsences: [{ staff_id: 2 }],
          appointments: date === "2026-11-19" ? [{
            id: 3, version: 1, client_id: 7, staff_id: 1, service_id: 1,
            price_dzd: 1000, cash_sale_id: appointmentSaleId,
            services: [{ id: 1, name: "Coupe", duration_minutes: 30, price_dzd: 1000 }],
            starts_at: date + " 11:00:00", ends_at: date + " 11:30:00",
            first_name: "Test", last_name: "Client", service_name: "Coupe", private_note: "",
            ...window.agendaAppointmentOverride,
          }, {
            id: 4, version: 1, client_id: 8, staff_id: 1, service_id: 1, cash_sale_id: 20,
            price_dzd: 1000,
            voided_at: "2026-11-18 10:00:00",
            starts_at: date + " 12:00:00", ends_at: date + " 12:30:00",
            first_name: "Autre", last_name: "Client", service_name: "Coupe encaissée", private_note: "",
          }] : [],
          services: [{ id: 1, name: "Coupe", duration_minutes: 30, price_dzd: 1000 }],
          displaySettings: { showTime: true, showClient: true, showServices: true, showNote: true, showAddButton: true },
        };
      } else if (url.pathname.endsWith("/api/professional-clients.php")) {
        if (options?.method === "POST") {
          const body = JSON.parse(options.body);
          if (body.clientId !== 7 || body.action !== "save_note") throw Error("Unexpected client mutation");
          clientNote = body.note;
          data = { message: "Note enregistrée." };
        } else if (!url.searchParams.has("clientId")) {
          data = { total: 1, hasMore: false, clients: [{
            id: 7, first_name: "Test", last_name: "Client", email: "client@example.test",
            phone_number: "0550123456", appointment_count: 2, latest_visit: null,
          }] };
        } else {
          if (url.searchParams.get("clientId") !== "7") throw Error("Unexpected client");
          const secondPage = url.searchParams.get("historyPage") === "2";
          data = {
            client: {
              id: 7, first_name: "Test", last_name: "Client", email: "client@example.test",
              phone_number: "0550123456", date_of_birth: "1990-01-01",
              appointment_count: 2, confirmed_count: 2, cancelled_count: 0,
              latest_visit: null, next_appointment: null, total_spent_dzd: 0,
              private_note: clientNote, private_note_updated_at: null,
            },
            appointments: [{
              id: secondPage ? 1 : 3, starts_at: secondPage ? "2026-10-10 09:00:00" : "2026-11-19 11:00:00",
              service_name: secondPage ? "Ancien soin" : "Coupe", status: "confirmed",
              price_dzd: 1000, private_note: "", sale_total_dzd: null,
            }],
            hasMoreHistory: !secondPage,
          };
        }
      } else if (url.pathname.endsWith("/api/professional-cash.php")) {
        if (options?.method === "POST") {
          window.cashRequests.push(JSON.parse(options.body));
          if (window.cashRequests.length === 1) {
            return new Response(JSON.stringify({ error: "Réponse temporairement indisponible." }), {
              status: 503, headers: { "Content-Type": "application/json" },
            });
          }
          appointmentSaleId = 21;
          data = { saleId: appointmentSaleId };
        } else if (url.searchParams.get("view") === "catalog") {
          data = { items: [], hasMore: false };
        } else if (url.searchParams.get("view") === "sale") {
          if (window.saleLookupFails) {
            return new Response(JSON.stringify({ error: "Vente introuvable." }), {
              status: 404, headers: { "Content-Type": "application/json" },
            });
          }
          const saleId = Number(url.searchParams.get("saleId"));
          data = {
            id: saleId, recorded_at: saleId === 20 ? "2026-10-10 10:00:00" : "2026-11-19 10:30:45", payment_method: "cash",
            total_dzd: 1000, collected_dzd: 1000, gift_card_applied_dzd: 0,
            voided_at: saleId === 20 ? "2026-11-18 10:00:00" : null,
            void_reason: saleId === 20 ? "Erreur de saisie" : null,
            lines: [{ item_kind: "service", item_id: 1, item_name: "Coupe", quantity: 1, unit_price_dzd: 1000 }],
          };
        } else {
          data = { netDzd: 1000, hasMore: false, entries: [{
            id: 21, event_kind: "sale", amount_dzd: 1000,
            event_at: "2026-11-19 10:30:45", payment_method: "cash",
          }] };
        }
      } else if (url.pathname.endsWith("/api/availability.php")) {
        const selectedStaff = url.searchParams.has("staffId");
        window.availabilityQuery = Object.fromEntries(url.searchParams);
        if (window.multiGuestTest && window.clientBookingGuest) {
          return new Response(JSON.stringify({ error: "Connectez-vous pour continuer." }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        if (window.staffUnavailable === "inactive" && selectedStaff) {
          return new Response(JSON.stringify({ error: "Ce collaborateur n’est plus disponible." }), { status: 422, headers: { "Content-Type": "application/json" } });
        }
        data = {
          slots: window.clientBookingTest
            ? ((window.clientBookingGuest || window.staffUnavailable) && !selectedStaff) || (window.staffUnavailable === "absent" && selectedStaff) ? [] : ["09:00", "09:15", "10:30", "11:00"]
            : ["10:45", "11:30", "11:45"],
          staff: window.clientBookingTest
            ? (window.clientBookingGuest || selectedStaff || window.staffUnavailable) ? [{ id: 1, name: "Sonia", is_absent: window.staffUnavailable === "absent" }] : []
            : [
          { id: 1, name: "Sonia", is_absent: false }, { id: 2, name: "Lina", is_absent: true },
          ],
        };
      } else if (url.pathname.endsWith("/api/appointments.php")) {
        if (window.clientBookingTest && options?.method !== "POST") {
          data = { appointments: url.searchParams.get("filter") === "past"
            ? [{ ...window.clientAppointments[1], id: 57, status: "confirmed", starts_at: "2026-11-18 10:30:00", ends_at: "2026-11-18 11:45:00" }]
            : window.clientAppointments, hasMore: false };
          return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        window.appointmentMutations++;
        window.lastAppointmentPayload = JSON.parse(options.body);
        if (window.conflictMode) {
          return new Response(JSON.stringify({ code: "appointment_changed", error: "Ce rendez-vous a changé depuis son affichage." }), {
            status: 409, headers: { "Content-Type": "application/json" },
          });
        }
        if (window.clientBookingTest && window.cancelTestMode && JSON.parse(options.body).action === "cancel") {
          window.cancelPayload = JSON.parse(options.body);
          if (window.cancelTestMode === "success") {
            window.clientAppointments.find(appointment => appointment.id === window.cancelPayload.appointmentId).status = "cancelled";
            return new Response(JSON.stringify({ message: "Rendez-vous annulé." }), { status: 200, headers: { "Content-Type": "application/json" } });
          }
          return new Response(JSON.stringify({ error: "Ce rendez-vous ne peut plus être modifié." }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        if (window.bookingConfirmationTest) {
          window.bookingPayload = JSON.parse(options.body);
          data = { appointmentId: 55, message: "Votre rendez-vous est confirmé." };
          if (!window.missingConfirmationDetails) {
            const ids = window.bookingPayload.serviceIds || [window.bookingPayload.serviceId];
            const catalog = [{ id: 1, name: "Coupe test", duration_minutes: 30, price_dzd: 1000 }, ...(window.extraServices || [])];
            data.services = window.confirmedServicesOverride || ids.map(id => catalog.find(service => String(service.id) === String(id)));
          }
          return new Response(JSON.stringify(data), { status: 201, headers: { "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: "Ce créneau n’est plus disponible." }), {
          status: 409, headers: { "Content-Type": "application/json" },
        });
      } else return originalFetch(input, options);
      return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
    };
  ` });
  await send("Page.navigate", { url: `${origin}/masalledereception/espace-professionnel` });
  await waitFor("!!document.querySelector('.agenda-slot-free')");
  assert.equal(await evaluate("document.querySelectorAll('.agenda-day-column:not(.agenda-day-column-absent) .agenda-slot-free[tabindex=\"0\"]').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.agenda-day-column-absent button.agenda-slot-free').length"), 0);
  await evaluate("document.querySelector('.agenda-slot-free[tabindex=\"0\"]').focus()");
  assert.match(await evaluate("document.activeElement.getAttribute('aria-label')"), /Sonia.*10:45/);
  await key("ArrowDown");
  assert.match(await evaluate("document.activeElement.getAttribute('aria-label')"), /Sonia.*11:30/);
  await key("ArrowUp");
  assert.match(await evaluate("document.activeElement.getAttribute('aria-label')"), /Sonia.*10:45/);
  await key("ArrowDown");
  await key("Enter");
  await waitFor("!!document.querySelector('.agenda-create')");
  await evaluate("document.querySelector('.agenda-client-search input').focus()");
  await new Promise((resolve) => setTimeout(resolve, 5200));
  assert.equal(await evaluate("document.activeElement.matches('.agenda-client-search input')"), true);
  await evaluate("Array.from(document.querySelectorAll('.agenda-create button')).find(b => b.textContent.includes('Créer la fiche')).click()");
  await evaluate("document.querySelector('.agenda-service-picker input').click()");
  await waitFor("!!document.querySelector('.agenda-create .booking-time-option input[value=\"11:30\"]')");
  assert.equal(await evaluate("document.querySelector('.agenda-create .booking-time-option input[value=\"11:30\"]').checked"), true);
  await key("Escape");
  await waitFor("!document.querySelector('.agenda-create')");
  assert.match(await evaluate("document.activeElement.getAttribute('aria-label')"), /Sonia.*11:30/);
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("!!document.querySelector('.agenda-client-link')");
  await evaluate("document.querySelector('.agenda-client-link').click()");
  await waitFor("!!document.querySelector('.agenda-client-info textarea')");
  assert.equal(await evaluate("document.querySelector('.agenda-client-info textarea').value"), "Préférence salon");
  await evaluate(`(() => {
    const textarea = document.querySelector('.agenda-client-info textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'Nouvelle préférence');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate("document.querySelector('.client-private-note button').click()");
  await waitFor("document.querySelector('.agenda-client-info textarea')?.value === 'Nouvelle préférence'");
  await evaluate("Array.from(document.querySelectorAll('.agenda-client-info button')).find(b => b.textContent.includes('plus anciens')).click()");
  await waitFor("document.querySelector('.agenda-client-info')?.textContent.includes('Ancien soin')");
  await key("Escape");
  await waitFor("!document.querySelector('[role=dialog]')");
  await evaluate(`(() => {
    window.agendaAppointmentOverride = { services: [], service_name: 'Détail manquant' };
    Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click();
  })()`);
  await waitFor("document.querySelector('.agenda-booking')?.textContent.includes('Détail manquant')");
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("document.querySelector('.agenda-detail [role=alert]')?.textContent.includes('détail enregistré')");
  assert.equal(await evaluate("!!document.querySelector('.agenda-detail .agenda-service-lines')"), false);
  assert.equal(await evaluate("document.querySelector('.agenda-cash-button').disabled"), true);
  await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(button => button.textContent === 'Modifier le rendez-vous').click()");
  assert.match(await evaluate("document.querySelector('.agenda-edit [role=status]').textContent"), /Sélectionnez à nouveau/);
  assert.equal(await evaluate("document.querySelectorAll('.agenda-edit .agenda-service-picker input:checked').length"), 0);
  assert.equal(await evaluate("document.querySelector('.agenda-edit button[type=submit]').disabled"), true);
  await evaluate("document.querySelector('.agenda-edit .agenda-service-picker input').click()");
  await waitFor("document.querySelectorAll('.agenda-edit .booking-time-option').length === 3");
  await key("Escape");
  await evaluate(`(() => {
    window.agendaAppointmentOverride = { service_name: 'Coupe + Soin partiel',
      services: [{ id: 1, name: 'Coupe', duration_minutes: 30, price_dzd: 1000 }] };
    Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click();
  })()`);
  await waitFor("document.querySelector('.agenda-booking')?.textContent.includes('Soin partiel')");
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("document.querySelector('.agenda-detail [role=alert]')?.textContent.includes('incohérent')");
  assert.equal(await evaluate("document.querySelector('.agenda-cash-button').disabled"), true);
  await key("Escape");
  await evaluate(`(() => {
    window.agendaAppointmentOverride = { service_name: 'Coupe + Soin indisponible',
      services: [{ id: 1, name: 'Coupe', duration_minutes: 15, price_dzd: 300 },
                 { id: 2, name: 'Soin indisponible', duration_minutes: 15, price_dzd: 700 }] };
    Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click();
  })()`);
  await waitFor("document.querySelector('.agenda-booking')?.textContent.includes('Soin indisponible')");
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("document.querySelectorAll('.agenda-detail .agenda-service-lines li').length === 2");
  assert.equal(await evaluate("document.querySelector('.agenda-cash-button').disabled"), false);
  await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(button => button.textContent === 'Modifier le rendez-vous').click()");
  assert.match(await evaluate("document.querySelector('.agenda-edit [role=status]').textContent"), /Sélectionnez à nouveau/);
  assert.equal(await evaluate("document.querySelectorAll('.agenda-edit .agenda-service-picker input:checked').length"), 0);
  await key("Escape");
  await evaluate("window.agendaAppointmentOverride = null; Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click()");
  await waitFor("document.querySelector('.agenda-booking')?.textContent.includes('Coupe') && !document.querySelector('.agenda-booking').textContent.includes('indisponible')");
  await evaluate("window.agendaAppointmentOverride = { version: null }; Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click()");
  await waitFor("window.agendaAppointmentOverride?.version === null && !!document.querySelector('.agenda-booking')");
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("document.querySelector('.agenda-detail [role=alert]')?.textContent.includes('version')");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Modifier le rendez-vous').disabled"), true);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Annuler le rendez-vous').disabled"), true);
  await key("Escape");
  await evaluate("window.agendaAppointmentOverride = null; Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click()");
  await waitFor("!!document.querySelector('.agenda-booking')");
  assert.equal(await evaluate("document.querySelectorAll('.agenda-booking')[1].draggable"), false);
  await evaluate(`(() => {
    window.agendaDrag = new DataTransfer();
    document.querySelector('.agenda-booking').dispatchEvent(new DragEvent('dragstart', {
      bubbles: true, cancelable: true, dataTransfer: window.agendaDrag,
    }));
  })()`);
  await waitFor("document.querySelector('.pro-agenda').classList.contains('agenda-dragging')");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.agenda-booking')).pointerEvents"), "none");
  const dragOver = (column, row) => evaluate(`(() => {
    const target = document.querySelectorAll('.agenda-day-column')[${column}].querySelectorAll('.agenda-slot')[${row}];
    return !target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.agendaDrag }));
  })()`);
  assert.equal(await dragOver(0, 7), true, "10:45 may overlap the original 11:00 appointment");
  assert.equal(await dragOver(0, 11), false, "11:45 cannot fit before the 12:00 appointment");
  assert.equal(await dragOver(0, 35), false, "17:45 cannot fit a 30-minute appointment before closing");
  assert.equal(await dragOver(1, 7), false, "an absent collaborator cannot receive a drop");
  await evaluate(`document.querySelector('.agenda-day-column').querySelectorAll('.agenda-slot')[7]
    .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.agendaDrag }))`);
  await waitFor("document.querySelector('.agenda-edit .booking-time-option input[value=\"10:45\"]')?.checked");
  assert.equal(await evaluate("window.appointmentMutations"), 0, "dropping must only propose a move");
  await evaluate("document.querySelector('.agenda-edit button[type=submit]').click()");
  await waitFor("document.querySelector('.agenda-detail [role=alert]')?.textContent.includes('plus disponible')");
  assert.equal(await evaluate("window.appointmentMutations"), 1);
  assert.equal(await evaluate("window.lastAppointmentPayload.expectedVersion"), 1);
  await evaluate("window.conflictMode = true; document.querySelector('.agenda-edit button[type=submit]').click()");
  await waitFor("document.querySelector('.agenda-detail [role=alert]')?.textContent.includes('a changé')");
  assert.equal(await evaluate("document.querySelector('.agenda-edit button[type=submit]').disabled"), true);
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Annuler le rendez-vous').disabled"), true);
  await evaluate("window.conflictMode = false; Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Actualiser l’agenda').click()");
  await waitFor("!document.querySelector('[role=dialog]')");
  await waitFor("!!document.querySelector('.agenda-booking')");
  await evaluate("window.confirm = () => true; window.conflictMode = true; document.querySelector('.agenda-booking').click()");
  await waitFor("!!document.querySelector('.agenda-detail')");
  await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Annuler le rendez-vous').click()");
  await waitFor("document.querySelector('.agenda-detail [role=alert]')?.textContent.includes('a changé')");
  assert.deepEqual(await evaluate("window.lastAppointmentPayload"), { action: "cancel", appointmentId: 3, expectedVersion: 1 });
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Annuler le rendez-vous').disabled"), true);
  await evaluate("window.conflictMode = false; Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Actualiser l’agenda').click()");
  await waitFor("!document.querySelector('[role=dialog]')");
  assert.match(await evaluate("document.querySelector('.agenda-booking').textContent"), /11:00–11:30/);
  await evaluate("window.agendaPauses = true; Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click()");
  await waitFor("document.querySelectorAll('.agenda-slot-pause').length > 0");
  assert.equal(await evaluate("document.querySelectorAll('.agenda-day-column')[0].querySelectorAll('.agenda-slot')[16].classList.contains('agenda-slot-pause')"), true);
  assert.equal(await evaluate("document.querySelectorAll('.agenda-day-column')[0].querySelectorAll('.agenda-slot')[20].classList.contains('agenda-slot-pause')"), true);
  assert.equal(await evaluate("document.querySelectorAll('.agenda-day-column')[0].querySelectorAll('.agenda-slot')[22].classList.contains('agenda-slot-pause')"), false);
  await evaluate(`(() => {
    window.agendaDrag = new DataTransfer();
    document.querySelector('.agenda-booking').dispatchEvent(new DragEvent('dragstart', {
      bubbles: true, cancelable: true, dataTransfer: window.agendaDrag,
    }));
  })()`);
  assert.equal(await dragOver(0, 15), false, "a move overlapping a salon pause must be rejected");
  assert.equal(await dragOver(0, 20), false, "a move overlapping the collaborator pause must be rejected");
  assert.equal(await dragOver(0, 22), true, "a move after both pauses remains possible");
  await evaluate("document.querySelector('.agenda-booking').dispatchEvent(new DragEvent('dragend', { bubbles: true }))");
  await evaluate("window.agendaPauses = false; Array.from(document.querySelectorAll('.agenda-toolbar button')).find(b => b.textContent === 'Actualiser').click()");
  await waitFor("document.querySelectorAll('.agenda-slot-pause').length === 0");
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Admin').click()");
  await evaluate("document.querySelector('.pro-mobile-menu').click()");
  await evaluate("Array.from(document.querySelectorAll('.pro-sidebar nav button')).find(b => b.textContent === 'Collaborateurs').click()");
  await waitFor("document.querySelector('.pro-panel h2')?.textContent === 'Collaborateurs'");
  await evaluate("Array.from(document.querySelectorAll('.service-list button')).find(b => b.textContent === 'Modifier').click()");
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"Début pause Lundi\"]').value"), "12:00");
  assert.equal(await evaluate("document.querySelector('input[aria-label=\"Fin pause Lundi\"]').value"), "13:00");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const start = document.querySelector('input[aria-label="Début pause Lundi"]');
    const end = document.querySelector('input[aria-label="Fin pause Lundi"]');
    setValue.call(start, '12:15');
    start.dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(end, '13:15');
    end.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate("document.querySelector('.pro-panel .auth-form button[type=submit]').click()");
  await waitFor("window.staffSaveBody?.hours[0]?.pause_starts_at === '12:15'");
  assert.equal(await evaluate("window.staffSaveBody.hours[0].pause_ends_at"), "13:15");
  await evaluate("Array.from(document.querySelectorAll('.pro-sidebar nav button')).find(b => b.textContent === 'Salon et horaires').click()");
  await waitFor("document.querySelector('.pro-panel h2')?.textContent === 'Mon salon et mes horaires'");
  assert.equal(await evaluate("document.querySelector('.pro-panel input[name=city]').value"), "Sétif");
  await evaluate(`(() => {
    const input = document.querySelector('.pro-panel input[name=city]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Ora');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("window.citySuggestionQuery === 'Ora'");
  assert.equal(await evaluate("document.querySelector('.pro-panel input[name=city]').list.options[0]?.value"), "Oran");
  assert.equal(await evaluate("document.querySelector('.pro-panel input[name=city]').value"), "Ora", "the professional can keep an unlisted Algerian city");
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Agenda').click()");
  await waitFor("!!document.querySelector('.agenda-day-column')");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await waitFor("document.querySelectorAll('.agenda-day-column').length === 1");
  assert.equal(await evaluate("document.querySelector('.agenda-scroll').scrollWidth <= document.querySelector('.agenda-scroll').clientWidth"), true);
  assert.equal(await evaluate("document.querySelector('.agenda-scroll').getBoundingClientRect().height > innerHeight * .65"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.pro-tabs')).position"), "fixed");
  await evaluate("(() => { const select = document.querySelector('[aria-label=\"Collaborateur affiché\"]'); select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await waitFor("!!document.querySelector('.agenda-day-column-absent')");
  assert.equal(await evaluate("document.querySelectorAll('.agenda-slot-free').length"), 0);
  await evaluate("(() => { const select = document.querySelector('[aria-label=\"Collaborateur affiché\"]'); select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await waitFor("!!document.querySelector('.agenda-slot-free')");
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("!!document.querySelector('.agenda-detail')");
  await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(button => button.textContent === 'Modifier le rendez-vous').click()");
  await waitFor("document.querySelectorAll('.agenda-edit .booking-time-option').length === 3");
  assert.equal(await evaluate("document.querySelector('.agenda-edit .booking-time-picker legend').textContent"), "Horaire · 3 créneaux disponibles");
  await evaluate("document.querySelector('.agenda-edit .booking-time-option input[value=\"11:30\"]').click()");
  assert.equal(await evaluate("document.querySelector('.agenda-edit .booking-time-option input[value=\"11:30\"]').checked"), true);
  await evaluate("document.querySelector('.agenda-detail-header button').click()");
  await waitFor("!document.querySelector('.agenda-detail')");
  await evaluate("document.querySelector('.pro-mobile-menu').click()");
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.pro-sidebar')).display"), "block");
  await evaluate("document.querySelector('.pro-mobile-menu').click()");
  await evaluate("document.querySelector('.agenda-slot-free[tabindex=\"0\"]').click()");
  await waitFor("!!document.querySelector('.agenda-create')");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await key("Escape");
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Clients').click()");
  await waitFor("!!document.querySelector('.client-directory-row')");
  await evaluate("Array.from(document.querySelectorAll('.client-directory-actions button')).find(b => b.textContent === 'Ouvrir la fiche').click()");
  await waitFor("!!document.querySelector('.client-profile-panel textarea')");
  assert.equal(await evaluate("document.querySelector('.client-profile-panel textarea').value"), "Nouvelle préférence");
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Agenda').click()");
  await waitFor("!!document.querySelector('.agenda-booking')");
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("!!document.querySelector('.agenda-cash-button')");
  await evaluate("document.querySelector('.agenda-cash-button').click()");
  await waitFor("document.querySelector('.pro-tabs [aria-current=page]')?.textContent === 'Caisse'");
  await waitFor("document.querySelector('.pro-panel h2')?.textContent === 'Encaisser le rendez-vous de Test Client'");
  assert.match(await evaluate("document.querySelector('.pro-panel .agenda-service-lines').textContent"), /Coupe.*1.?000 DA/);
  assert.equal(await evaluate("window.cashRequests.length"), 0, "opening checkout must not record a sale");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.workspace-tabs button')).find(b => b.textContent === 'Tickets en attente').disabled"), true);
  await evaluate("document.querySelector('.pro-panel .auth-form button[type=submit]').click()");
  await waitFor("document.querySelector('.pro-panel [role=alert]')?.textContent.includes('temporairement indisponible')");
  assert.match(await evaluate("document.querySelector('.pro-panel .auth-form button[type=submit]').textContent"), /Réessayer la même vente/);
  await evaluate("document.querySelector('.pro-panel .auth-form button[type=submit]').click()");
  await waitFor("document.querySelector('.appointment-card h3')?.textContent === 'Détail de la vente n° 21'");
  const cashRequests = await evaluate("window.cashRequests");
  assert.equal(cashRequests.length, 2);
  assert.deepEqual(cashRequests[0], cashRequests[1], "retrying an uncertain response must reuse the same request");
  assert.equal(cashRequests[0].appointmentId, 3);
  assert.equal(cashRequests[0].action, "record");
  assert.equal(cashRequests[0].paymentMethod, "cash");
  assert.ok(cashRequests[0].requestKey);
  assert.deepEqual(cashRequests[0].lines, [{ kind: "service", id: 1, quantity: 1, expectedPrice: 1000 }]);
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Agenda').click()");
  await waitFor("!!document.querySelector('.agenda-booking')");
  await evaluate("document.querySelector('.agenda-booking').click()");
  await waitFor("!!document.querySelector('.agenda-detail')");
  assert.equal(await evaluate("!!document.querySelector('.agenda-cash-button')"), false);
  assert.match(await evaluate("document.querySelector('.agenda-detail').textContent"), /possède déjà une vente/);
  await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Voir la vente n° 21').click()");
  await waitFor("document.querySelector('.appointment-card h3')?.textContent === 'Détail de la vente n° 21'");
  assert.equal(await evaluate("document.querySelector('.workspace-tabs [aria-current=page]').textContent"), "Journal");
  await waitFor("document.querySelector('.appointment-card')?.textContent.includes('Coupe')");
  assert.equal(await evaluate("window.cashRequests.length"), 2, "consulting a linked sale must not record a payment");
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Agenda').click()");
  await waitFor("document.querySelectorAll('.agenda-booking').length === 2");
  await evaluate("document.querySelectorAll('.agenda-booking')[1].click()");
  await waitFor("!!document.querySelector('.agenda-detail')");
  assert.match(await evaluate("document.querySelector('.agenda-detail').textContent"), /journal \(annulée\)/);
  assert.equal(await evaluate("!!document.querySelector('.agenda-cash-button')"), false);
  await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Voir la vente n° 20').click()");
  await waitFor("document.querySelector('.appointment-card')?.textContent.includes('Erreur de saisie')");
  assert.equal(await evaluate("document.querySelector('.appointment-card h3').textContent"), "Détail de la vente n° 20");
  assert.equal(await evaluate("!!document.querySelector('.appointment-card form')"), false, "a voided sale cannot be voided again");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Agenda').click()");
  await waitFor("!!document.querySelector('.agenda-booking')");
  await evaluate("window.saleLookupFails = true; document.querySelector('.agenda-booking').click()");
  await waitFor("!!document.querySelector('.agenda-detail')");
  await evaluate("Array.from(document.querySelectorAll('.agenda-detail button')).find(b => b.textContent === 'Voir la vente n° 21').click()");
  await waitFor("document.querySelector('.appointment-card [role=alert]')?.textContent === 'Vente introuvable.'");
  assert.equal(await evaluate("!!document.querySelector('.appointment-card form')"), false);
  assert.equal(await evaluate("window.cashRequests.length"), 2);
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Agenda').click()");
  await waitFor("!!document.querySelector('.agenda-booking')");
  await evaluate("Array.from(document.querySelectorAll('.pro-tabs button')).find(b => b.textContent === 'Caisse').click()");
  await waitFor("document.querySelector('.workspace-tabs [aria-current=page]')?.textContent === 'Vente'");
  assert.equal(await evaluate("!!document.querySelector('.appointment-card')"), false, "normal cash navigation must not reopen an old sale");
  console.log("Agenda keyboard, mobile, rescheduling and checkout checks passed.");

  await send("Page.navigate", { url: `${origin}/masalledereception/recherche?q=Coupe&ville=S%C3%A9tif&wilaya=19&categorie=coiffeur&page=2` });
  await waitFor("window.directoryQuery?.page === '2'");
  const filterValues = () => evaluate("Object.fromEntries(new FormData(document.querySelector('.results-filters')))");
  assert.deepEqual(await filterValues(), { q: "Coupe", ville: "Sétif", wilaya: "19", tri: "" });
  await evaluate(`(() => {
    const input = document.querySelector('.results-filters input[name=ville]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Sé');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("window.citySuggestionQuery === 'Sé'");
  assert.equal(await evaluate("document.querySelector('.results-filters input[name=ville]').list.options[0]?.value"), "Sétif");
  assert.match(await evaluate("document.querySelector('.results-summary').textContent"), /Sétif · Wilaya : Sétif/);
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  await evaluate(`(() => {
    const form = document.querySelector('.results-filters');
    form.elements.q.value = '  Brushing  ';
    form.elements.ville.value = ' ';
    form.elements.wilaya.value = '31';
    form.elements.tri.value = 'prix';
    form.requestSubmit();
  })()`);
  await waitFor("window.directoryQuery?.wilaya === '31'");
  assert.deepEqual(await evaluate("window.directoryQuery"), { q: "Brushing", wilaya: "31", categorie: "coiffeur", tri: "prix" });
  assert.match(await evaluate("document.querySelector('.results-summary').textContent"), /Brushing.*Wilaya : Oran/);
  const nextResults = await evaluate("document.querySelector('.results-page .pagination a').href");
  assert.equal(new URL(nextResults).searchParams.get("tri"), "prix");
  assert.equal(new URL(nextResults).searchParams.get("page"), "2");
  const allCategories = await evaluate("document.querySelector('#categories a').href");
  assert.equal(new URL(allCategories).searchParams.get("tri"), "prix");
  await evaluate("history.back()");
  await waitFor("window.directoryQuery?.page === '2' && document.querySelector('.results-summary')?.textContent.includes('Coupe')");
  assert.deepEqual(await evaluate("window.directoryQuery"), { q: "Coupe", ville: "Sétif", wilaya: "19", categorie: "coiffeur", page: "2" });
  console.log("Public directory filters passed.");

  await send("Page.navigate", { url: `${origin}/masalledereception/recherche?q=Coupe&ville=S%C3%A9tif&wilaya=19&categorie=coiffeur&tri=prix&page=2` });
  await waitFor("window.directoryQuery?.tri === 'prix' && document.querySelectorAll('.empty-results a').length === 1");
  assert.match(await evaluate("document.querySelector('.empty-results a').textContent.trim()"), /wilaya de Sétif/);
  await evaluate("document.querySelector('.empty-results a').click()");
  await waitFor("window.directoryQuery?.wilaya === '19' && !window.directoryQuery.ville && document.querySelector('.empty-results a')?.textContent.includes('Algérie')");
  assert.deepEqual(await evaluate("window.directoryQuery"), { q: "Coupe", wilaya: "19", categorie: "coiffeur", tri: "prix" });
  await evaluate("document.querySelector('.empty-results a').click()");
  await waitFor("!window.directoryQuery?.wilaya && !!document.querySelector('.empty-results h2')");
  assert.deepEqual(await evaluate("window.directoryQuery"), { q: "Coupe", categorie: "coiffeur", tri: "prix" });
  assert.equal(await evaluate("!!document.querySelector('.empty-results a')"), false);

  await send("Page.navigate", { url: `${origin}/masalledereception/` });
  await waitFor("!!document.querySelector('.search-panel .location-field input')");
  await evaluate(`(() => {
    const input = document.querySelector('.search-panel .location-field input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Ora');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("window.citySuggestionQuery === 'Ora'");
  assert.equal(await evaluate("document.querySelector('.search-panel .location-field input').list.options[0]?.value"), "Oran");
  assert.equal(await evaluate("document.querySelector('.search-panel .location-field input').value"), "Ora", "suggestions must not replace the manually entered value");
  console.log("Algerian city suggestions passed.");

  await send("Page.navigate", { url: `${origin}/masalledereception/salons/1` });
  await waitFor("document.querySelector('.booking-content h1')?.textContent === 'Salon test'");
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').click()");
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  assert.equal(await evaluate("document.querySelector('.booking-time-picker legend').textContent"), "Horaire · 4 créneaux disponibles");
  assert.equal(await evaluate("document.querySelector('.booking-time-options').scrollWidth <= document.querySelector('.booking-time-options').clientWidth"), true);
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  await evaluate("Array.from(document.querySelectorAll('.booking-time-option input')).find(input => input.value === '10:30').click()");
  assert.equal(await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').checked"), true);
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), false);
  assert.equal(await evaluate("document.querySelector('.booking-time-selected span').textContent"), "10:30");
  console.log("Mobile booking time selection passed.");

  await send("Page.navigate", { url: `${origin}/masalledereception/salons/1?bookingTest=guest` });
  await waitFor("document.querySelector('.booking-content h1')?.textContent === 'Salon test' && document.querySelector('.booking-content a.inline-link')?.textContent.includes('Connexion')");
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').click()");
  await waitFor("document.querySelector('.booking-content select')?.querySelector('option[value=\"1\"]')?.textContent === 'Sonia'");
  await evaluate(`(() => {
    const select = document.querySelector('.booking-content select');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  const loginUrl = await evaluate("document.querySelector('.booking-content a.inline-link').href");
  const returnTo = new URL(loginUrl).searchParams.get("retour");
  const returnParams = new URL(returnTo, origin).searchParams;
  assert.equal(new URL(returnTo, origin).pathname, "/salons/1");
  assert.equal(returnParams.get("serviceId"), "1");
  assert.equal(returnParams.get("date"), "2026-11-19");
  assert.equal(returnParams.get("time"), "10:30");
  assert.equal(returnParams.get("staffId"), "1");
  await evaluate("document.querySelector('.booking-content a.inline-link').click()");
  await waitFor("!!document.querySelector('.auth-form input[name=email]')");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('.auth-form input[name=email]');
    const password = document.querySelector('.auth-form input[name=password]');
    setValue.call(email, 'client@example.test');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(password, 'test-password');
    password.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await evaluate("document.querySelector('.auth-form button[type=submit]').click()");
  await waitFor("window.location.pathname === '/masalledereception/salons/1' && !!document.querySelector('.booking-content h1')");
  await waitFor("document.querySelector('.booking-time-option input[value=\"10:30\"]')?.checked");
  assert.equal(await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').checked"), true);
  assert.equal(await evaluate("document.querySelector('.booking-content select').value"), "1");
  assert.equal(await evaluate("document.querySelector('.booking-content input[type=date]').value"), "2026-11-19");
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), false);
  assert.deepEqual(await evaluate("window.loginPayload"), { email: "client@example.test", password: "test-password" });
  await evaluate("window.bookingConfirmationTest = true; document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("!!document.querySelector('.booking-confirmation')");
  const confirmation = await evaluate("document.querySelector('.booking-confirmation').textContent");
  assert.match(confirmation, /Votre rendez-vous est confirmé/);
  assert.match(confirmation, /Salon test/);
  assert.match(confirmation, /Coupe test/);
  assert.match(confirmation, /19 novembre 2026.*10:30/);
  assert.match(confirmation, /Sonia/);
  assert.match(confirmation, /30 min/);
  assert.match(confirmation, /1.?000 DA/);
  await evaluate("Array.from(document.querySelectorAll('.booking-confirmation + button')).find(button => button.textContent.includes('calendrier')).click()");
  await waitFor("window.calendarFiles.length === 1");
  const calendarFile = await evaluate("window.calendarFiles[0]");
  assert.equal(calendarFile.type, "text/calendar;charset=utf-8");
  assert.match(calendarFile.text, /DTSTART:20261119T093000Z/);
  assert.match(calendarFile.text, /DTEND:20261119T100000Z/);
  assert.match(calendarFile.text, /LOCATION:10 rue de test\\, Sétif/);
  assert.deepEqual(await evaluate("window.bookingPayload"), {
    action: "book", salonId: "1", serviceId: "1", date: "2026-11-19", time: "10:30",
    expectedPrice: 1000, expectedDuration: 30, staffId: 1,
  });
  console.log("Booking choices preserved through client login.");

  await evaluate("Array.from(document.querySelectorAll('.booking-content a')).find(link => link.textContent === 'Voir mes rendez-vous').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  assert.equal(await evaluate("new URL(document.querySelector('.appointment-list a[href*=\"appointmentId=\"]').href).searchParams.get('version')"), "1");
  await evaluate("window.clientAppointments[0].version = null; document.querySelector('.booking-toolbar button').click()");
  await waitFor("Array.from(document.querySelectorAll('.appointment-list [role=alert]')).some(item => item.textContent.includes('version'))");
  assert.equal(await evaluate("document.querySelector('.appointment-list .review-reject').disabled"), true);
  assert.equal(await evaluate("!!document.querySelector('.appointment-list a[href*=\"appointmentId=\"]')"), false);
  await evaluate("window.clientAppointments[0].version = 1; document.querySelector('.booking-toolbar button').click()");
  await waitFor("!!document.querySelector('.appointment-list a[href*=\"appointmentId=\"]')");
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:nth-child(2)').textContent"), /Annulé.*Coupe annulée · 30 min.*Soin annulé · 45 min/);
  await evaluate("document.querySelector('.appointment-list .appointment-card a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  assert.equal(await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').checked"), true);
  assert.equal(await evaluate("document.querySelector('.booking-content select').value"), "1");
  assert.equal(await evaluate("document.querySelector('.booking-content input[type=date]').value"), "2026-11-20");
  assert.equal(await evaluate("document.querySelectorAll('.booking-time-option input:checked').length"), 0);
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  assert.deepEqual(await evaluate("window.availabilityQuery"), { salonId: "1", serviceIds: "1", date: "2026-11-20", staffId: "1", appointmentId: "55" });
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate("window.clientAppointments[0].service_name = 'Résumé incorrect'; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link')?.href.includes('unknownServices=1')");
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:first-child [role=alert]').textContent"), /incohérent/);
  await evaluate("window.clientAppointments[0].service_name = 'Coupe test'; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link')?.href.includes('serviceId=1')");
  await evaluate("window.clientAppointments[0].price_dzd = null; window.clientAppointments[0].services[0].price_dzd = 0; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link')?.href.includes('unknownServices=1')");
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:first-child').textContent"), /Tarif indisponible/);
  await evaluate("window.clientAppointments[0].price_dzd = 2500; window.clientAppointments[0].services[0].price_dzd = 2500; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link')?.href.includes('serviceId=1')");
  await evaluate("window.staffUnavailable = 'inactive'; document.querySelector('.appointment-list .appointment-card a.admin-nav-link').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('collaborateur n’est plus disponible')");
  await waitFor("document.querySelectorAll('.booking-content select').length === 1");
  assert.equal(await evaluate("document.querySelector('.booking-content select').value"), "");
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate("window.staffUnavailable = 'absent'; document.querySelector('.appointment-list .appointment-card a.admin-nav-link').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('collaborateur n’est plus disponible')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-time-option input:checked').length"), 0);
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate(`(() => {
    window.staffUnavailable = '';
    window.extraServices = [{ id: 2, name: 'Soin test', category: 'coiffeur', duration_minutes: 45, price_dzd: 1500 }];
    window.clientAppointments[0].service_count = 2;
    window.clientAppointments[0].service_name = 'Coupe test + Soin test';
    window.clientAppointments[0].ends_at = '2026-11-20 11:45:00';
    window.clientAppointments[0].services = [
      { id: 1, name: 'Coupe test', duration_minutes: 30, price_dzd: 1000 },
      { id: 2, name: 'Soin test', duration_minutes: 45, price_dzd: 1500 },
    ];
    document.querySelector('.booking-toolbar button').click();
  })()`);
  await waitFor("document.querySelector('.appointment-list .appointment-card a.admin-nav-link')?.href.includes('serviceIds=1%2C2')");
  const savedDetails = await evaluate("Array.from(document.querySelectorAll('.appointment-list .appointment-card:first-child .booking-service-breakdown li')).map(item => item.textContent)");
  assert.match(savedDetails[0], /Coupe test · 30 min · 1.?000 DA/);
  assert.match(savedDetails[1], /Soin test · 45 min · 1.?500 DA/);
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:first-child').textContent"), /75 min.*2.?500 DA/);
  await evaluate("window.clientAppointments[0].services[1].price_dzd = null; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card [role=alert]')?.textContent.includes('détail des prestations est indisponible')");
  assert.equal(await evaluate("!!document.querySelector('.appointment-list .appointment-card:first-child .booking-service-breakdown')"), false);
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link').href"), /unknownServices=1/);
  await evaluate("Array.from(document.querySelectorAll('.appointment-list button')).find(button => button.textContent.includes('calendrier')).click()");
  await waitFor("window.calendarFiles.length === 2");
  const invalidDetailsCalendar = await evaluate("window.calendarFiles[1].text.replace(/\\r\\n[ \\t]/g, '')");
  assert.match(invalidDetailsCalendar, /détail des prestations est indisponible/);
  assert.doesNotMatch(invalidDetailsCalendar, /- Coupe test/);
  await evaluate("window.calendarFiles.pop()");
  await evaluate("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('Vérifiez les prestations')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 0);
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').click()");
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate("window.clientAppointments[0].services[1].price_dzd = 1500; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card:first-child .booking-service-breakdown li').length === 2");
  await evaluate("Array.from(document.querySelectorAll('.appointment-list button')).find(button => button.textContent.includes('calendrier')).click()");
  await waitFor("window.calendarFiles.length === 2");
  const savedDetailsCalendar = await evaluate("window.calendarFiles[1].text.replace(/\\r\\n[ \\t]/g, '')");
  assert.match(savedDetailsCalendar, /- Coupe test : 30 min\\, 1.?000 DA\\n- Soin test : 45 min\\, 1.?500 DA/);
  await evaluate("window.calendarFiles.pop()");
  await evaluate("window.clientAppointments[0].service_name = 'Résumé incohérent'; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child [role=alert]')?.textContent.includes('détail des prestations est indisponible')");
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link').href"), /unknownServices=1/);
  await evaluate("window.clientAppointments[0].service_name = 'Coupe test + Soin test'; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card:first-child .booking-service-breakdown li').length === 2");
  await evaluate(`(() => {
    window.savedMultiServices = window.clientAppointments[0].services;
    window.clientAppointments[0].services = [window.savedMultiServices[0]];
    window.clientAppointments[0].service_count = 1;
    document.querySelector('.booking-toolbar button').click();
  })()`);
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link')?.href.includes('unknownServices=1')");
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:first-child [role=alert]').textContent"), /incohérent/);
  await evaluate("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('Vérifiez les prestations')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 0);
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate("window.clientAppointments[0].services = window.savedMultiServices; window.clientAppointments[0].service_count = 2; window.clientAppointments[0].service_id = 2; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link')?.href.includes('unknownServices=1')");
  await evaluate("window.clientAppointments[0].service_id = 1; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card:first-child a.admin-nav-link')?.href.includes('serviceIds=1%2C2')");
  await evaluate("document.querySelector('.appointment-list .appointment-card a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.booking-content input[name=bookingService]:checked')).map(input => input.value)"), ["1", "2"]);
  assert.equal(await evaluate("document.querySelector('.booking-content input[type=date]').value"), "2026-11-20");
  assert.match(await evaluate("document.querySelector('.booking-content form').textContent"), /Coupe test \+ Soin test · 75 minutes.*2.?500 DA/);
  assert.equal(await evaluate("window.availabilityQuery.serviceIds"), "1,2");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"2\"]').click()");
  await waitFor("window.availabilityQuery.serviceIds === '1' && document.querySelectorAll('.booking-time-option').length === 4");
  assert.equal(await evaluate("document.querySelectorAll('.booking-time-option input:checked').length"), 0);
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').click()");
  await waitFor("document.querySelectorAll('.booking-time-option').length === 0");
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').click()");
  await waitFor("window.availabilityQuery.serviceIds === '1' && document.querySelectorAll('.booking-time-option').length === 4");
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"2\"]').click()");
  await waitFor("window.availabilityQuery.serviceIds === '1,2' && document.querySelectorAll('.booking-time-option').length === 4");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  await evaluate("window.bookingConfirmationTest = false; document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-content [role=alert]')?.textContent.includes('n’est plus disponible')");
  assert.equal(await evaluate("window.clientAppointments[0].service_count"), 2);
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  await evaluate("window.bookingConfirmationTest = true; document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("!!document.querySelector('.booking-confirmation')");
  assert.deepEqual(await evaluate("window.bookingPayload.serviceIds"), [1, 2]);
  assert.equal(await evaluate("window.bookingPayload.expectedDuration"), 75);
  assert.equal(await evaluate("window.bookingPayload.expectedPrice"), 2500);
  assert.match(await evaluate("document.querySelector('.booking-confirmation .booking-service-breakdown').textContent"), /Coupe test · 30 min.*Soin test · 45 min/);
  await evaluate("document.querySelector('.booking-confirmation + button').click()");
  await waitFor("window.calendarFiles.length === 2");
  const multiCalendar = await evaluate("window.calendarFiles[1].text.replace(/\\r\\n[ \\t]/g, '')");
  assert.match(multiCalendar, /SUMMARY:Coupe test \+ Soin test - Salon test/);
  assert.match(multiCalendar, /DTSTART:20261120T093000Z/);
  assert.match(multiCalendar, /DTEND:20261120T104500Z/);
  assert.match(multiCalendar, /- Coupe test : 30 min\\, 1.?000 DA\\n- Soin test : 45 min\\, 1.?500 DA/);
  await evaluate("window.calendarFiles.pop()");
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate("window.extraServices = []; document.querySelector('.appointment-list .appointment-card a.admin-nav-link').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('Certaines prestations initiales')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 0);
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate("window.clientAppointments[0].service_count = 0; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card a.admin-nav-link')?.href.includes('unknownServices=1')");
  assert.match(await evaluate("document.querySelector('.appointment-list .appointment-card:first-child [role=alert]').textContent"), /détail des prestations est indisponible/);
  await evaluate("document.querySelector('.appointment-list .appointment-card a.admin-nav-link').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('Vérifiez les prestations')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 0);
  await evaluate("document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  await evaluate("window.clientAppointments[0].service_count = 1; window.clientAppointments[0].service_name = 'Coupe test'; window.clientAppointments[0].services = [{ id: 1, name: 'Coupe test', duration_minutes: 45, price_dzd: 2500 }]; window.clientAppointments[0].ends_at = '2026-11-20 11:15:00'; window.hideService = true; document.querySelector('.booking-toolbar button').click()");
  await waitFor("document.querySelector('.appointment-list .appointment-card a.admin-nav-link')?.href.includes('serviceId=1')");
  await evaluate("document.querySelector('.appointment-list .appointment-card a.admin-nav-link').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('Certaines prestations initiales')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 0);
  await evaluate("window.hideService = false; document.querySelector('.commercial-header a.admin-nav-link').click()");
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  console.log("Client rescheduling defaults and unavailable selections passed.");
  assert.equal(await evaluate("document.querySelectorAll('.appointment-list button').length"), 2, "only the future confirmed appointment offers calendar and cancellation");
  await evaluate("Array.from(document.querySelectorAll('.appointment-list button')).find(button => button.textContent.includes('calendrier')).click()");
  await waitFor("window.calendarFiles.length === 2");
  const accountCalendar = await evaluate("window.calendarFiles[1].text.replace(/\\r\\n[ \\t]/g, '')");
  assert.match(accountCalendar, /UID:appointment-55-salon-1@bookili\.com/);
  assert.match(accountCalendar, /DTSTART:20261120T093000Z/);
  assert.match(accountCalendar, /DTEND:20261120T101500Z/);
  assert.match(accountCalendar, /SUMMARY:Coupe test - Salon test/);
  assert.match(accountCalendar, /LOCATION:10 rue de test\\, Sétif/);
  assert.match(accountCalendar, /Collaborateur : Sonia/);
  assert.match(accountCalendar, /Tarif : 2.?500 DA/);
  await evaluate(`(() => {
    window.clientAppointments[0].starts_at = '2026-11-21 14:00:00';
    window.clientAppointments[0].ends_at = '2026-11-21 15:00:00';
    Array.from(document.querySelectorAll('.booking-toolbar button')).find(button => button.textContent === 'Actualiser').click();
  })()`);
  await waitFor("document.querySelector('.appointment-list .appointment-card')?.textContent.includes('21 novembre')");
  await evaluate("Array.from(document.querySelectorAll('.appointment-list button')).find(button => button.textContent.includes('calendrier')).click()");
  await waitFor("window.calendarFiles.length === 3");
  assert.match(await evaluate("window.calendarFiles[2].text"), /DTSTART:20261121T130000Z/);
  assert.match(await evaluate("window.calendarFiles[2].text"), /DTEND:20261121T140000Z/);
  await evaluate(`(() => {
    window.clientAppointments[0].starts_at = '2026-11-22 14:00:00';
    window.clientAppointments[0].ends_at = '2026-11-22 13:00:00';
    document.querySelector('.booking-toolbar button').click();
  })()`);
  await waitFor("document.querySelector('.appointment-list .appointment-card')?.textContent.includes('22 novembre')");
  await evaluate("document.querySelector('.appointment-list button').click()");
  await waitFor("Array.from(document.querySelectorAll('.appointment-list [role=alert]')).some(item => item.textContent.includes('Impossible de préparer'))");
  assert.equal(await evaluate("window.calendarFiles.length"), 3, "invalid appointment data must not create a calendar file");
  await evaluate(`(() => {
    const filter = document.querySelector('[aria-label="Filtre des rendez-vous"]');
    filter.value = 'past';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 1");
  assert.equal(await evaluate("document.querySelectorAll('.appointment-list button').length"), 0, "past appointments do not offer calendar downloads");
  assert.equal(await evaluate("document.querySelectorAll('.appointment-list .booking-service-breakdown li').length"), 2);
  console.log("Client appointment calendar downloads passed.");

  await evaluate(`(() => {
    const filter = document.querySelector('[aria-label="Filtre des rendez-vous"]');
    filter.value = 'upcoming';
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    window.cancelTestMode = 'fail';
    window.confirmAnswer = false;
    window.confirm = message => { window.confirmMessage = message; return window.confirmAnswer; };
  })()`);
  await waitFor("document.querySelectorAll('.appointment-list .appointment-card').length === 2");
  const mutationsBeforeCancellation = await evaluate("window.appointmentMutations");
  await evaluate("document.querySelector('.appointment-list .review-reject').click()");
  const cancelConfirmation = await evaluate("window.confirmMessage");
  assert.match(cancelConfirmation, /Coupe test · Salon test/);
  assert.match(cancelConfirmation, /22 novembre 2026.*(?:14:00|2:00 PM)/);
  assert.match(cancelConfirmation, /calendrier.*supprimer manuellement/);
  assert.equal(await evaluate("window.appointmentMutations"), mutationsBeforeCancellation);
  await evaluate("window.confirmAnswer = true; document.querySelector('.appointment-list .review-reject').click()");
  await waitFor("document.querySelector('.client-card [role=alert]')?.textContent.includes('ne peut plus être modifié')");
  assert.equal(await evaluate("window.clientAppointments[0].status"), "confirmed");
  assert.equal(await evaluate("document.querySelector('.client-card [role=status]')"), null);
  await evaluate("window.conflictMode = true; document.querySelector('.appointment-list .review-reject').click()");
  await waitFor("document.querySelector('.client-card [role=alert]')?.textContent.includes('a changé')");
  assert.equal(await evaluate("document.querySelector('.appointment-list .review-reject').disabled"), true);
  assert.equal(await evaluate("!!document.querySelector('.appointment-list a[href*=\"appointmentId=\"]')"), false);
  await evaluate("window.conflictMode = false; document.querySelector('.booking-toolbar button').click()");
  await waitFor("!!document.querySelector('.appointment-list a[href*=\"appointmentId=\"]')");
  await evaluate("window.cancelTestMode = 'success'; document.querySelector('.appointment-list .review-reject').click()");
  await waitFor("document.querySelector('.client-card [role=status]')?.textContent.includes('Rendez-vous annulé')");
  assert.deepEqual(await evaluate("window.cancelPayload"), { action: "cancel", appointmentId: 55, expectedVersion: 1 });
  assert.match(await evaluate("document.querySelector('.client-card [role=status]').textContent"), /e-mail d’annulation.*attente d’envoi.*calendrier.*supprimez-le manuellement/);
  await waitFor("document.querySelectorAll('.appointment-list .review-reject').length === 0");
  console.log("Client cancellation confirmation and error handling passed.");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?appointmentId=55&serviceId=1&date=2026-11-19&time=10%3A30`,
  });
  await waitFor("document.querySelector('.booking-content [role=alert]')?.textContent.includes('vos rendez-vous')");
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?appointmentId=55&version=1&serviceId=1&date=2026-11-19&time=10%3A30`,
  });
  await waitFor("document.querySelector('.booking-time-option input[value=\"10:30\"]')?.checked");
  await evaluate("window.conflictMode = true; document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-content [role=alert]')?.textContent.includes('a changé')");
  assert.equal(await evaluate("window.lastAppointmentPayload.expectedVersion"), 1);
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  assert.equal(await evaluate("!!document.querySelector('.booking-confirmation')"), false);
  assert.equal(await evaluate("!!document.querySelector('.booking-content a[href$=\"/espace-client\"]')"), true);

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?appointmentId=55&version=1&serviceId=1&date=2026-11-19&time=10%3A30`,
  });
  await waitFor("document.querySelector('.booking-time-option input[value=\"10:30\"]')?.checked");
  assert.match(await evaluate("document.querySelector('.booking-content .client-card').textContent"), /tarifs et durées affichés.*réservation actuelle reste inchangée/);
  await evaluate("document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-content [role=alert]')?.textContent.includes('n’est plus disponible')");
  assert.equal(await evaluate("!!document.querySelector('.booking-confirmation')"), false);
  await waitFor("!!document.querySelector('.booking-time-option input[value=\"10:30\"]')");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  await evaluate("window.bookingConfirmationTest = true; document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("!!document.querySelector('.booking-confirmation')");
  const modification = await evaluate("document.querySelector('.booking-confirmation').textContent");
  assert.match(modification, /Votre rendez-vous a bien été modifié/);
  assert.match(modification, /e-mail de modification/);
  assert.match(modification, /calendrier.*mettez-le à jour manuellement.*pas synchronisé automatiquement/);
  assert.equal(await evaluate("window.bookingPayload.action"), "reschedule");
  assert.equal(await evaluate("window.bookingPayload.appointmentId"), "55");
  assert.equal(await evaluate("window.bookingPayload.expectedVersion"), 1);
  console.log("Client rescheduling guidance and confirmation passed.");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?appointmentId=55&version=7&serviceIds=1%2C2&date=2026-11-20&staffId=1&bookingTest=guest&multiTest=1`,
  });
  await waitFor("document.querySelectorAll('.booking-content input[name=bookingService]').length === 7");
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"2\"]').click()");
  for (const id of [3, 4, 5, 6, 7]) {
    await evaluate(`document.querySelector('.booking-content input[name=bookingService][value="${id}"]').click()`);
  }
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 6);
  assert.equal(await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"2\"]').disabled"), true);
  const multiReturnUrl = await evaluate("document.querySelector('.booking-content a.inline-link').href");
  const multiReturn = new URL(new URL(multiReturnUrl).searchParams.get("retour"), origin);
  assert.equal(multiReturn.searchParams.get("serviceIds"), "1,3,4,5,6,7");
  assert.equal(multiReturn.searchParams.get("version"), "7");
  await evaluate("document.querySelector('.booking-content a.inline-link').click()");
  await waitFor("!!document.querySelector('.auth-form input[name=email]')");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [name, value] of [['email', 'client@example.test'], ['password', 'test-password']]) {
      const input = document.querySelector('.auth-form input[name=' + name + ']');
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await waitFor("!document.querySelector('.auth-form button[type=submit]').disabled");
  await evaluate("document.querySelector('.auth-form button[type=submit]').click()");
  await waitFor("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length === 6");
  assert.equal(await evaluate("new URL(location.href).searchParams.get('version')"), "7");
  assert.equal(await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"2\"]').disabled"), true);
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"3\"]').click()");
  assert.equal(await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"2\"]').disabled"), false);
  console.log("Multi-service selection limit and login restoration passed.");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?serviceId=1&bookingTest=guest&multiTest=booking`,
  });
  await waitFor("!!document.querySelector('.booking-content select')?.querySelector('option[value=\"1\"]')");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= window.innerWidth"), true);
  assert.equal(await evaluate("document.querySelector('.booking-service-picker .checkbox-label').getBoundingClientRect().height >= 44"), true);
  await evaluate(`(() => {
    const select = document.querySelector('.booking-content select');
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"2\"]').click()");
  await waitFor("window.availabilityQuery.serviceIds === '1,2' && document.querySelectorAll('.booking-time-option').length === 4");
  assert.equal(await evaluate("document.querySelectorAll('.booking-time-option input:checked').length"), 0);
  assert.match(await evaluate("document.querySelector('.booking-content form').textContent"), /Coupe test \+ Prestation 2 · 45 minutes.*1.?500 DA/);
  for (const id of [3, 4, 5, 6]) {
    await evaluate(`document.querySelector('.booking-content input[name=bookingService][value="${id}"]').click()`);
  }
  assert.equal(await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"7\"]').disabled"), true);
  for (const id of [3, 4, 5, 6]) {
    await evaluate(`document.querySelector('.booking-content input[name=bookingService][value="${id}"]').click()`);
  }
  await waitFor("window.availabilityQuery.serviceIds === '1,2' && document.querySelectorAll('.booking-time-option').length === 4");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  const multiBookingReturn = new URL(new URL(await evaluate("document.querySelector('.booking-content a.inline-link').href")).searchParams.get("retour"), origin);
  assert.equal(multiBookingReturn.searchParams.get("serviceIds"), "1,2");
  assert.equal(multiBookingReturn.searchParams.get("time"), "10:30");
  assert.equal(multiBookingReturn.searchParams.get("staffId"), "1");
  await evaluate("document.querySelector('.booking-content a.inline-link').click()");
  await waitFor("!!document.querySelector('.auth-form input[name=email]')");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [name, value] of [['email', 'client@example.test'], ['password', 'test-password']]) {
      const input = document.querySelector('.auth-form input[name=' + name + ']');
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await waitFor("!document.querySelector('.auth-form button[type=submit]').disabled");
  await evaluate("document.querySelector('.auth-form button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-time-option input[value=\"10:30\"]')?.checked");
  assert.deepEqual(await evaluate("Array.from(document.querySelectorAll('.booking-content input[name=bookingService]:checked')).map(input => input.value)"), ["1", "2"]);
  await evaluate("document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-content [role=alert]')?.textContent.includes('n’est plus disponible')");
  await waitFor("document.querySelectorAll('.booking-time-option').length === 4");
  assert.equal(await evaluate("document.querySelectorAll('.booking-time-option input:checked').length"), 0);
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  await evaluate(`(() => {
    window.confirmedServicesOverride = [
      { id: 1, name: 'Coupe enregistrée', duration_minutes: 35, price_dzd: 800 },
      { id: 2, name: 'Soin enregistré', duration_minutes: 10, price_dzd: 700 },
    ];
    window.bookingConfirmationTest = true;
    document.querySelector('.booking-content button[type=submit]').click();
  })()`);
  await waitFor("!!document.querySelector('.booking-confirmation')");
  assert.deepEqual(await evaluate("window.bookingPayload"), {
    action: "book", salonId: "1", serviceIds: [1, 2], date: "2026-11-19", time: "10:30",
    expectedPrice: 1500, expectedDuration: 45, staffId: 1,
  });
  const confirmedDetails = await evaluate("Array.from(document.querySelectorAll('.booking-confirmation .booking-service-breakdown li')).map(item => item.textContent)");
  assert.match(confirmedDetails[0], /Coupe enregistrée · 35 min · 800 DA/);
  assert.match(confirmedDetails[1], /Soin enregistré · 10 min · 700 DA/);
  assert.match(await evaluate("document.querySelector('.booking-confirmation').textContent"), /45 min.*1.?500 DA/);
  await evaluate("document.querySelector('.booking-confirmation + button').click()");
  await waitFor("window.calendarFiles.length === 1");
  const bookingMultiCalendar = await evaluate("window.calendarFiles[0].text.replace(/\\r\\n[ \\t]/g, '')");
  assert.match(bookingMultiCalendar, /SUMMARY:Coupe enregistrée \+ Soin enregistré - Salon test/);
  assert.match(bookingMultiCalendar, /DTSTART:20261119T093000Z/);
  assert.match(bookingMultiCalendar, /DTEND:20261119T101500Z/);
  assert.match(bookingMultiCalendar, /- Coupe enregistrée : 35 min\\, 800 DA\\n- Soin enregistré : 10 min\\, 700 DA/);
  console.log("Multi-service client booking and calendar passed.");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?serviceId=1&time=10%3A30`,
  });
  await waitFor("document.querySelector('.booking-time-option input[value=\"10:30\"]')?.checked");
  await evaluate("window.bookingConfirmationTest = true; window.missingConfirmationDetails = true; document.querySelector('.booking-content button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-confirmation [role=alert]')?.textContent.includes('rendez-vous est confirmé')");
  assert.equal(await evaluate("!!document.querySelector('.booking-confirmation + button')"), false);
  assert.equal(await evaluate("!!document.querySelector('.booking-confirmation .booking-service-breakdown')"), false);
  console.log("Missing confirmation details are reported without a misleading calendar.");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?appointmentId=55&version=1&unknownServices=1&date=2026-11-20&bookingTest=guest`,
  });
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('Vérifiez les prestations')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 0);
  await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').click()");
  await waitFor("!!document.querySelector('.booking-content select')");
  await evaluate("(() => { const select = document.querySelector('.booking-content select'); select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await waitFor("!!document.querySelector('.booking-time-option input[value=\"10:30\"]')");
  await evaluate("document.querySelector('.booking-time-option input[value=\"10:30\"]').click()");
  const manualReturn = new URL(await evaluate("document.querySelector('.booking-content a.inline-link').href")).searchParams.get("retour");
  assert.equal(new URL(manualReturn, origin).searchParams.get("serviceIds"), "1");
  await evaluate("document.querySelector('.booking-content a.inline-link').click()");
  await waitFor("!!document.querySelector('.auth-form input[name=email]')");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [name, value] of [['email', 'client@example.test'], ['password', 'test-password']]) {
      const input = document.querySelector('.auth-form input[name=' + name + ']');
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await waitFor("!document.querySelector('.auth-form button[type=submit]').disabled");
  await evaluate("document.querySelector('.auth-form button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-time-option input[value=\"10:30\"]')?.checked");
  assert.equal(await evaluate("document.querySelector('.booking-content input[name=bookingService][value=\"1\"]').checked"), true);
  assert.equal(await evaluate("document.querySelector('.booking-content input[type=date]').value"), "2026-11-20");
  console.log("Explicit service choices remain available after client login.");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?serviceIds=1%2C2&bookingTest=guest&multiTest=booking`,
  });
  await waitFor("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length === 2");
  await evaluate("window.hideService = true; document.querySelector('.booking-content a.inline-link').click()");
  await waitFor("!!document.querySelector('.auth-form input[name=email]')");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [name, value] of [['email', 'client@example.test'], ['password', 'test-password']]) {
      const input = document.querySelector('.auth-form input[name=' + name + ']');
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await waitFor("!document.querySelector('.auth-form button[type=submit]').disabled");
  await evaluate("document.querySelector('.auth-form button[type=submit]').click()");
  await waitFor("document.querySelector('.booking-content [role=status]')?.textContent.includes('Certaines prestations choisies')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-content input[name=bookingService]:checked').length"), 0);
  assert.equal(await evaluate("document.querySelector('.booking-content button[type=submit]').disabled"), true);
  console.log("Unavailable booking selections require an explicit choice.");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/compte?retour=${encodeURIComponent("/salons/1?appointmentId=55&serviceIds=1%2C1")}`,
  });
  await waitFor("!!document.querySelector('.auth-form input[name=email]')");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [name, value] of [['email', 'client@example.test'], ['password', 'test-password']]) {
      const input = document.querySelector('.auth-form input[name=' + name + ']');
      setValue.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await waitFor("!document.querySelector('.auth-form button[type=submit]').disabled");
  await evaluate("document.querySelector('.auth-form button[type=submit]').click()");
  await waitFor("window.location.pathname === '/masalledereception/espace-client'");

  await send("Page.navigate", {
    url: `${origin}/masalledereception/salons/1?serviceId=1&date=2026-11-19&time=17%3A00`,
  });
  await waitFor("document.querySelector('.booking-content .field-hint[role=status]')?.textContent.includes('n’est plus disponible')");
  assert.equal(await evaluate("document.querySelectorAll('.booking-time-option input:checked').length"), 0);

  await send("Page.navigate", {
    url: `${origin}/masalledereception/compte?retour=${encodeURIComponent("https://example.test/")}`,
  });
  await waitFor("!!document.querySelector('.auth-form input[name=email]')");
  await evaluate(`(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const email = document.querySelector('.auth-form input[name=email]');
    const password = document.querySelector('.auth-form input[name=password]');
    setValue.call(email, 'client@example.test');
    email.dispatchEvent(new Event('input', { bubbles: true }));
    setValue.call(password, 'test-password');
    password.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor("!document.querySelector('.auth-form button[type=submit]').disabled");
  await evaluate("document.querySelector('.auth-form button[type=submit]').click()");
  await waitFor("window.location.pathname === '/masalledereception/espace-client'");
  assert.equal(await evaluate("window.location.origin"), origin);
} finally {
  const closed = once(chrome, "exit");
  chrome.kill("SIGTERM");
  await closed;
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await new Promise((resolve) => server.httpServer.close(resolve));
}
