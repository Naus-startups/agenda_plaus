import multer from "multer";

// One image per request, buffered in memory (it goes straight on to storage; the API may
// run on a read-only filesystem). Beyond the size cap, a request can't carry extra files or
// stuff large text fields alongside the image. The type is checked by the services and the
// file's first bytes by gallery.storage.ts — the declared mimetype is only a claim.
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 8 * 1024, parts: 6 },
});

// A payment proof (photo or PDF of a transfer). 4 MB: the dashboard forwards it through
// a serverless function whose request body is capped at 4.5 MB. Contents are checked in
// payments.storage.ts.
export const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 5, fieldSize: 8 * 1024, parts: 6 },
});
