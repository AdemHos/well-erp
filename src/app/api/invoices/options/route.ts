import { withPermission } from "@/lib/rbac";
import { invoiceOptions } from "@/lib/invoice-read";
export const GET = withPermission("finance.manage", invoiceOptions);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
