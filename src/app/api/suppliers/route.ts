import { withPermission } from "@/lib/rbac";
import { listSuppliers } from "@/lib/supplier-read";
import { createSupplier } from "@/lib/supplier-service";
export const GET = withPermission("suppliers.read", listSuppliers);
export const POST = withPermission("suppliers.manage", createSupplier);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
