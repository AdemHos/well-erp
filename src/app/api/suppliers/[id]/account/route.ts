import { withPermission } from "@/lib/rbac";
import { linkSupplierAccount } from "@/lib/supplier-service";
export const POST = withPermission("suppliers.manage", linkSupplierAccount);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
