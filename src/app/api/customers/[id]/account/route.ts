import { withPermission } from "@/lib/rbac";
import { linkCustomerAccount } from "@/lib/customer-service";
export const POST = withPermission("customers.manage", linkCustomerAccount);
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
