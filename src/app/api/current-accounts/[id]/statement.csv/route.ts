import { withPermission } from "@/lib/rbac";
import { NextRequest } from "next/server";
import { type AccountContext } from "@/lib/current-accounts-service";
import { accountStatement } from "@/lib/current-account-statement";
export const GET = withPermission("finance.manage", (request: NextRequest, context: AccountContext) => accountStatement(request, context, true));
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
