self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  if (request.method !== "GET" || request.mode !== "navigate" || url.origin !== scope.origin
    || !url.pathname.startsWith(scope.pathname) || url.pathname.startsWith(`${scope.pathname}api/`)) return;
  event.respondWith(fetch(request).catch(() => new Response(
    '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BOOKILI hors ligne</title><main><h1>BOOKILI est hors ligne</h1><p>Une connexion est nécessaire pour consulter votre compte ou effectuer une réservation.</p><button onclick="location.reload()">Réessayer</button></main></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )));
});
