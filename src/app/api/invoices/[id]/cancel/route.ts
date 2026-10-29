import { withPermission } from "@/lib/rbac";
import { cancelInvoice } from "@/lib/invoice-service";
export const POST = withPermission("finance.manage", cancelInvoice);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
