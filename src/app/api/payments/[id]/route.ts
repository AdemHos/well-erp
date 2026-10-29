import { withPermission } from "@/lib/rbac";
import { getPayment } from "@/lib/payment-read";
export const GET = withPermission("finance.manage", getPayment);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
