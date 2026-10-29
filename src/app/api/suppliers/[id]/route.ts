import { withPermission } from "@/lib/rbac";
import { getSupplier } from "@/lib/supplier-read";
import { updateSupplier } from "@/lib/supplier-service";
export const GET = withPermission("suppliers.read", getSupplier);
export const PATCH = withPermission("suppliers.manage", updateSupplier);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
