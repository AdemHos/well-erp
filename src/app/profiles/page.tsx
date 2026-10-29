import { redirect } from "next/navigation";
import { getBaseMembership } from "@/lib/current-membership";
import ProfilePicker from "@/components/staff/ProfilePicker";
import { AccessError } from "@/lib/auth-context";
export default async function ProfilesPage() {
  const base = await getBaseMembership({ required: true }).catch((error: unknown) => { if (error instanceof AccessError) redirect(error.status === 401 ? "/login" : "/dashboard"); throw error; });
  if (!base) redirect("/login");
  return <ProfilePicker />;
}
