import { Router } from "express";
import { imageUpload as upload } from "../../shared/middleware/upload";
import { authenticate } from "../../shared/middleware/authenticate";
import { validate } from "../../shared/middleware/validate";
import { usersController } from "./users.controller";
import { changePasswordSchema, updateLocationSchema, updateProfileSchema } from "./users.schema";
import { byUser, rateLimit } from "../../shared/middleware/rateLimit";

export const usersRoutes = Router();

// Someone holding a stolen session can't use this to guess the current password.
const passwordLimit = rateLimit("change-password", { windowMs: 15 * 60_000, max: 10, key: byUser });

usersRoutes.use(authenticate);
usersRoutes.get("/me", usersController.me);
usersRoutes.patch("/me", validate(updateProfileSchema), usersController.updateMe);
usersRoutes.post("/me/avatar", upload.single("file"), usersController.uploadAvatar);
usersRoutes.delete("/me/avatar", usersController.removeAvatar);
usersRoutes.put("/me/location", validate(updateLocationSchema), usersController.updateLocation);
usersRoutes.post("/me/password", passwordLimit, validate(changePasswordSchema), usersController.changePassword);
usersRoutes.delete("/me", usersController.deleteMe);
