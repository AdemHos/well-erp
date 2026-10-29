import { withPermission } from "@/lib/rbac";
import { getInvoice, updateInvoice } from "@/lib/invoice-service";
export const GET = withPermission("finance.manage", getInvoice);
export const PATCH = withPermission("finance.manage", updateInvoice);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
