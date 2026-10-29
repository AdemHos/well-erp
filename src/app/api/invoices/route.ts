import { withPermission } from "@/lib/rbac";
import { createInvoice } from "@/lib/invoice-service";
import { listInvoices } from "@/lib/invoice-read";
export const GET = withPermission("finance.manage", listInvoices);
export const POST = withPermission("finance.manage", createInvoice);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
