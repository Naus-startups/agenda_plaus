import { Router } from "express";
import { imageUpload as upload } from "../../shared/middleware/upload";
import { authenticate } from "../../shared/middleware/authenticate";
import { authorize } from "../../shared/middleware/authorize";
import { validate } from "../../shared/middleware/validate";
import { galleryController } from "./gallery.controller";
import { uploadGalleryImageSchema } from "./gallery.schema";

// mergeParams: true — this router is mounted at /businesses/:businessId/gallery, and
// needs that :businessId from the parent path.
export const galleryRoutes = Router({ mergeParams: true });

galleryRoutes.get("/", galleryController.listByBusiness);
galleryRoutes.post(
  "/",
  authenticate,
  authorize("OWNER"),
  upload.single("file"),
  validate(uploadGalleryImageSchema),
  galleryController.upload,
);
galleryRoutes.patch("/:id/cover", authenticate, authorize("OWNER"), galleryController.setCover);
galleryRoutes.delete("/:id", authenticate, authorize("OWNER"), galleryController.remove);
