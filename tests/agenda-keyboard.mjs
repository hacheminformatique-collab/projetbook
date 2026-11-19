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
    let appointmentSaleId = null;
    window.fetch = async (input, options) => {
      const url = new URL(typeof input === "string" ? input : input.url, location.href);
      let data;
      if (url.pathname.endsWith("/api/session.php")) {
        data = { authenticated: true, account: { role: "professional" }, csrfToken: "test" };
      } else if (url.pathname.endsWith("/api/professional-salon.php")) {
        data = { salon: { id: 1, name: "Salon test", is_public: 1 }, hours: [] };
      } else if (url.pathname.endsWith("/api/professional-agenda.php")) {
        const date = url.searchParams.get("date");
        data = {
          salonId: 1, date, hours: { opens_at: "09:00:00", closes_at: "18:00:00" }, closed: false,
          staff: [
            { id: 1, name: "Sonia", is_active: 1, opens_at: "09:00:00", closes_at: "18:00:00" },
            { id: 2, name: "Lina", is_active: 1, opens_at: "09:00:00", closes_at: "18:00:00" },
          ],
          staffAbsences: [{ staff_id: 2 }],
          appointments: date === "2026-11-19" ? [{
            id: 3, client_id: 7, staff_id: 1, service_id: 1,
            price_dzd: 1000, cash_sale_id: appointmentSaleId,
            services: [{ id: 1, name: "Coupe", duration_minutes: 30, price_dzd: 1000 }],
            starts_at: date + " 11:00:00", ends_at: date + " 11:30:00",
            first_name: "Test", last_name: "Client", service_name: "Coupe", private_note: "",
          }, {
            id: 4, client_id: 8, staff_id: 1, service_id: 1, cash_sale_id: 20,
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
          data = {
            id: 21, recorded_at: "2026-11-19 10:30:45", payment_method: "cash",
            total_dzd: 1000, collected_dzd: 1000, gift_card_applied_dzd: 0,
            lines: [{ item_kind: "service", item_id: 1, item_name: "Coupe", quantity: 1, unit_price_dzd: 1000 }],
          };
        } else {
          data = { netDzd: 1000, hasMore: false, entries: [{
            id: 21, event_kind: "sale", amount_dzd: 1000,
            event_at: "2026-11-19 10:30:45", payment_method: "cash",
          }] };
        }
      } else if (url.pathname.endsWith("/api/availability.php")) {
        data = { slots: ["10:45", "11:30", "11:45"], staff: [
          { id: 1, name: "Sonia", is_absent: false }, { id: 2, name: "Lina", is_absent: true },
        ] };
      } else if (url.pathname.endsWith("/api/appointments.php")) {
        window.appointmentMutations++;
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
  await waitFor("!!document.querySelector('.agenda-create select option[value=\"11:30\"]')");
  assert.equal(await evaluate("Array.from(document.querySelectorAll('.agenda-create select')).find(s => s.querySelector('option[value=\"11:30\"]')).value"), "11:30");
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
  await waitFor("document.querySelector('.agenda-edit select option[value=\"10:45\"]')?.selected");
  assert.equal(await evaluate("window.appointmentMutations"), 0, "dropping must only propose a move");
  await evaluate("document.querySelector('.agenda-edit button[type=submit]').click()");
  await waitFor("document.querySelector('.agenda-detail [role=alert]')?.textContent.includes('plus disponible')");
  assert.equal(await evaluate("window.appointmentMutations"), 1);
  await key("Escape");
  await waitFor("!document.querySelector('[role=dialog]')");
  assert.match(await evaluate("document.querySelector('.agenda-booking').textContent"), /11:00–11:30/);
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
  console.log("Agenda keyboard, mobile, rescheduling and checkout checks passed.");
} finally {
  const closed = once(chrome, "exit");
  chrome.kill("SIGTERM");
  await closed;
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await new Promise((resolve) => server.httpServer.close(resolve));
}
