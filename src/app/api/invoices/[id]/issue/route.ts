import { withPermission } from "@/lib/rbac";
import { issueInvoice } from "@/lib/invoice-service";
export const POST = withPermission("finance.manage", issueInvoice);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
