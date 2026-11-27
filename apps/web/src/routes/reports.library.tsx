import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/reports/library")({
  beforeLoad: () => {
    throw redirect({ to: "/reports", replace: true });
  },
});
