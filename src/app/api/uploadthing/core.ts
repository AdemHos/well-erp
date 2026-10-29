import {
  createUploadthing,
  type FileRouter,
} from "uploadthing/next";

import { UploadThingError } from "uploadthing/server";

import { getCurrentMembership } from "@/lib/current-membership";
import { hasPermission, hasAllBranches } from "@/lib/permissions";

const f = createUploadthing();

export const ourFileRouter = {
  businessLogo: f({ image: { maxFileSize: "4MB", maxFileCount: 1 } })
    .middleware(async () => {
      const actor = await getCurrentMembership();
      if (!actor || !hasPermission(actor.role, "settings.organization.manage") || !hasAllBranches(actor)) throw new UploadThingError("İşletme logosu yükleme yetkiniz yok.");
      return { organizationId: actor.organizationId };
    })
    .onUploadComplete(async ({ file }) => ({ imageUrl: file.ufsUrl })),
  productImage: f({
    image: {
      maxFileSize: "4MB",
      maxFileCount: 1,
    },
  })
    .middleware(async () => {
      const membership =
        await getCurrentMembership();

      if (!membership) {
        throw new UploadThingError(
          "Bu işlem için giriş yapmalısınız."
        );
      }
      if (!hasPermission(membership.role, "products.manage")) throw new UploadThingError("Ürün görseli yükleme yetkiniz yok.");

      return {
        organizationId:
          membership.organizationId,
      };
    })
    .onUploadComplete(
      async ({ file }) => {
        return {
          imageUrl: file.ufsUrl,
        };
      }
    ),
} satisfies FileRouter;

export type OurFileRouter =
  typeof ourFileRouter;
