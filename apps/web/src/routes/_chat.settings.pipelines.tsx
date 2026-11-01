import { createFileRoute } from "@tanstack/react-router";

import { PipelinesSettingsPanel } from "../components/settings/PipelinesSettings";

export const Route = createFileRoute("/_chat/settings/pipelines")({
  component: PipelinesSettingsPanel,
});
