import { useEffect } from "react";
import type { Route } from "../state/store";
import { glassScene } from "../glass/scene";
import { PageView } from "./PageView";
import { HomeView } from "./HomeView";
import { TemplatesView } from "./TemplatesView";
import { AutomationsView } from "./AutomationsView";
import { SettingsView } from "./SettingsView";
import { ProfileView } from "./ProfileView";
import { ActivityView } from "./ActivityView";
import { IntegrationsView } from "./IntegrationsView";
import { TrashView } from "./TrashView";
import { MaterialLab } from "./MaterialLab";
import { ChatView } from "./ChatView";

export function RouteView(props: { route: Route; paneId: string; tabId: string }) {
  const key = JSON.stringify(props.route);
  // New content under the toolbar glass: let it adapt right away.
  useEffect(() => glassScene.resampleSoon(), [key]);
  return <RouteBody {...props} />;
}

function RouteBody({ route, paneId }: { route: Route; paneId: string; tabId: string }) {
  switch (route.kind) {
    case "page":
      return <PageView pageId={route.pageId} paneId={paneId} />;
    case "home":
      return <HomeView />;
    case "templates":
      return <TemplatesView />;
    case "automations":
      return <AutomationsView automationId={route.automationId} />;
    case "settings":
      return <SettingsView section={route.section} />;
    case "profile":
      return <ProfileView />;
    case "activity":
      return <ActivityView />;
    case "integrations":
      return <IntegrationsView />;
    case "trash":
      return <TrashView />;
    case "playground":
      return <MaterialLab />;
    case "chat":
      return <ChatView chatId={route.chatId} paneId={paneId} />;
  }
}
