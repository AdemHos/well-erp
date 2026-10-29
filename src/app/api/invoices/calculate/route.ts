import { NextRequest, NextResponse } from "next/server";
import { withPermission } from "@/lib/rbac";
import { jsonBody } from "@/lib/current-accounts-service";
import { onlyFields } from "@/lib/current-accounts";
import { invoiceFields, invoiceInput } from "@/lib/invoices";
import { invoiceError } from "@/lib/invoice-service";
export const POST = withPermission("finance.manage", async (request: NextRequest) => {
  try { const body = await jsonBody(request); onlyFields(body, invoiceFields); return NextResponse.json({ calculation: invoiceInput(body) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return invoiceError(error); }
});
export const runtime = "nodejs";
