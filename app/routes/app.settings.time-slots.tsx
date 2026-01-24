import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";

// Redirect to the new unified pickup availability page
export async function loader({ request }: LoaderFunctionArgs) {
  return redirect("/app/settings/pickup-availability", 301);
}

export default function TimeSlotsRedirect() {
  return null;
}
