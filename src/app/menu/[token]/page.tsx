import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccessError } from "@/lib/auth-context";
import { publicMenu } from "@/lib/qr-service";
import PublicMenu from "@/components/qr-menu/PublicMenu";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Menü · WellPOS", referrer: "no-referrer", robots: { index: false, follow: false } };
export default async function MenuPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ table?: string | string[] }> }) {
  const { token } = await params, query = await searchParams;
  const table = typeof query.table === "string" ? query.table : query.table ? "invalid" : null;
  let menu: Awaited<ReturnType<typeof publicMenu>>;
  try { menu = await publicMenu(token, table); }
  catch (e) { if (e instanceof AccessError && e.status === 404) notFound(); throw e; }
  return <PublicMenu menu={menu} publicToken={token} tableToken={menu.tableName ? table : null}/>;
}
