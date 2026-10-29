import { withPermission } from "@/lib/rbac";
import { createPayment } from "@/lib/payment-operations";
import { listPayments } from "@/lib/payment-read";
export const GET = withPermission("finance.manage", listPayments);
export const POST = withPermission("finance.manage", createPayment);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
