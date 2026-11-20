export function validServiceDetails(services, count, duration, price) {
  return Array.isArray(services) && services.length === count && count > 0
    && services.every((service) => service && Number.isSafeInteger(service.id) && service.id > 0
      && typeof service.name === "string" && service.name.trim()
      && Number.isSafeInteger(service.duration_minutes) && service.duration_minutes > 0
      && Number.isSafeInteger(service.price_dzd) && service.price_dzd >= 0)
    && new Set(services.map((service) => service.id)).size === services.length
    && services.reduce((total, service) => total + service.duration_minutes, 0) === duration
    && services.reduce((total, service) => total + service.price_dzd, 0) === price;
}
