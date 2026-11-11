import { Router, type Request, type Response } from "express";
import { NotFoundError } from "../../shared/errors";
import { authenticate } from "../../shared/middleware/authenticate";
import { validateQuery } from "../../shared/middleware/validate";
import { sendSuccess } from "../../shared/utils/apiResponse";
import { geoReverseQuerySchema, geoSearchQuerySchema, type GeoReverseQuery, type GeoSearchQuery } from "./geo.schema";
import { geoService } from "./geo.service";

export const geoRoutes = Router();

// Public: answered from the data that ships with the API (nothing is asked of
// OpenStreetMap), and the app needs it before anyone has signed in. It changes only with a
// new release, so clients and proxies may keep it for a day.
function cacheForADay(res: Response): void {
  res.set("Cache-Control", "public, max-age=86400");
}

geoRoutes.get("/provinces", (_req: Request, res: Response) => {
  cacheForADay(res);
  sendSuccess(res, geoService.provinces());
});

// A province's municípios, each with its seat and its bairros: the whole tree the location
// pickers need in one answer (Luanda's is a few kB).
geoRoutes.get("/provinces/:name/municipalities", (req: Request<{ name: string }>, res: Response) => {
  const municipalities = geoService.municipalities(req.params.name);
  if (!municipalities) throw new NotFoundError("Província não encontrada.", "PROVINCE_NOT_FOUND");
  cacheForADay(res);
  sendSuccess(res, municipalities);
});

// The same places as one flat list, for app versions released before the municípios.
geoRoutes.get("/provinces/:name/zones", (req: Request<{ name: string }>, res: Response) => {
  const zones = geoService.zones(req.params.name);
  if (!zones) throw new NotFoundError("Província não encontrada.", "PROVINCE_NOT_FOUND");
  cacheForADay(res);
  sendSuccess(res, zones);
});

// Authenticated on purpose: these forward to a rate-limited third party (Nominatim), so
// they are for an owner placing their business, not an open geocoding proxy. Customers
// never need them — they browse the localities that already have businesses.
geoRoutes.get("/search", authenticate, validateQuery(geoSearchQuerySchema), async (req: Request, res: Response) => {
  const { q } = req.validatedQuery as unknown as GeoSearchQuery;
  sendSuccess(res, await geoService.search(q));
});

geoRoutes.get("/reverse", authenticate, validateQuery(geoReverseQuerySchema), async (req: Request, res: Response) => {
  const { latitude, longitude } = req.validatedQuery as unknown as GeoReverseQuery;
  sendSuccess(res, await geoService.reverse(latitude, longitude));
});
