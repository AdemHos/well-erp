import { auth } from "@/auth";
import AcceptInvitation from "@/components/staff/AcceptInvitation";
export default async function InvitePage() {
  const session = await auth();
  return <AcceptInvitation email={session?.user?.email ?? null} />;
}
