import { withPermission } from "@/lib/rbac";
import { cancelPayment } from "@/lib/payment-operations";
export const POST = withPermission("finance.manage", cancelPayment);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
