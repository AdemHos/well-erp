import { withPermission } from "@/lib/rbac";
import { paymentOptions } from "@/lib/payment-read";
export const GET = withPermission("finance.manage", paymentOptions);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
