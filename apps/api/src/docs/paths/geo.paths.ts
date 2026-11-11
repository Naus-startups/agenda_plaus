import { z } from "zod";
import { geoReverseQuerySchema, geoSearchQuerySchema } from "../../modules/geo/geo.schema";
import { authErrors, bearerAuth, commonErrors, registry, successResponse } from "../registry";

const placeSchema = registry.register(
  "Place",
  z.object({
    displayName: z.string(),
    street: z.string(),
    bairro: z.string().nullable(),
    distrito: z.string().nullable(),
    municipio: z.string().nullable(),
    provincia: z.string().nullable(),
    latitude: z.number(),
    longitude: z.number(),
  }),
);

const pointSchema = { latitude: z.number(), longitude: z.number() };

registry.registerPath({
  method: "get",
  path: "/geo/provinces",
  tags: ["Geo"],
  summary: "As 21 províncias de Angola (Lei n.º 14/24), com o centro e a sede de cada uma",
  responses: {
    200: successResponse(
      z.array(z.object({ name: z.string(), ...pointSchema, capital: z.string(), municipalityCount: z.number().int() })),
    ),
    ...commonErrors,
  },
});

const municipalitySchema = registry.register(
  "Municipality",
  z.object({
    name: z.string(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    bairros: z.array(z.object({ name: z.string(), ...pointSchema })),
  }),
);

registry.registerPath({
  method: "get",
  path: "/geo/provinces/{name}/municipalities",
  tags: ["Geo"],
  summary: "Os municípios de uma província, com a sede e os bairros de cada um",
  request: { params: z.object({ name: z.string() }) },
  responses: { 200: successResponse(z.array(municipalitySchema)), ...commonErrors },
});

registry.registerPath({
  method: "get",
  path: "/geo/provinces/{name}/zones",
  tags: ["Geo"],
  summary: "Municípios e bairros de uma província numa só lista (versões antigas da app)",
  request: { params: z.object({ name: z.string() }) },
  responses: {
    200: successResponse(z.array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number() }))),
    ...commonErrors,
  },
});

registry.registerPath({
  method: "get",
  path: "/geo/search",
  tags: ["Geo"],
  summary: "Procurar uma morada ou localidade em Angola (OpenStreetMap)",
  security: bearerAuth,
  request: { query: geoSearchQuerySchema },
  responses: { 200: successResponse(z.array(placeSchema)), ...commonErrors, ...authErrors },
});

registry.registerPath({
  method: "get",
  path: "/geo/reverse",
  tags: ["Geo"],
  summary: "Morada e região de um ponto (OpenStreetMap), com a província, o município e o bairro nos nomes oficiais; null se não houver dados",
  security: bearerAuth,
  request: { query: geoReverseQuerySchema },
  responses: { 200: successResponse(placeSchema.nullable()), ...commonErrors, ...authErrors },
});
