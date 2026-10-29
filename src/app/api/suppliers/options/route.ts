import { withPermission } from "@/lib/rbac";
import { supplierOptions } from "@/lib/supplier-read";
export const GET = withPermission("suppliers.read", supplierOptions);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
