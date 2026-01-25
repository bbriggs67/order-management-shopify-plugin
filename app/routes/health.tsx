import type { LoaderFunction } from "@remix-run/node";

// Health check endpoint for Railway monitoring
export const loader: LoaderFunction = async () => {
  return new Response("OK", {
    status: 200,
    headers: {
      "Content-Type": "text/plain",
    },
  });
};
