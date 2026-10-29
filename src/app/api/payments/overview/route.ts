import { withPermission } from "@/lib/rbac";
import { paymentOverview } from "@/lib/payment-overview";
export const GET = withPermission("finance.manage", paymentOverview);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
