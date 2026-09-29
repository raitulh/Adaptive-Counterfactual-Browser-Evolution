/** Assembles the demo server: seeded store + engine + route table. */
import { seedActivity } from "../fixtures/activity";
import { seedAgents } from "../fixtures/agents";
import { seedAutomations } from "../fixtures/automations";
import { seedHistory } from "../fixtures/history";
import { seedIntegrations } from "../fixtures/integrations";
import { PROCESSING_FILE_ID, seedFiles, seedMemories } from "../fixtures/knowledge";
import { seedLab } from "../fixtures/lab";
import { seedWorkspace } from "../fixtures/workspace";
import { realScheduler, VirtualScheduler } from "./clock";
import { DemoEngine } from "./engine";
import { agentRoutes } from "./handlers/agents";
import { authRoutes } from "./handlers/auth";
import { automationRoutes } from "./handlers/automations";
import { integrationRoutes } from "./handlers/integrations";
import { knowledgeRoutes, processFile } from "./handlers/knowledge";
import { labRoutes } from "./handlers/lab";
import { taskRoutes } from "./handlers/tasks";
import { workspaceRoutes } from "./handlers/workspace";
import { dispatch, Router, type Srv } from "./router";
import { DemoStore } from "./store";
import { deterministic } from "./util";

export interface DemoServer extends Srv {
  handle(request: Request): Promise<Response>;
}

function routes(): Router {
  const r = new Router();
  authRoutes(r);
  taskRoutes(r);
  workspaceRoutes(r);
  agentRoutes(r);
  integrationRoutes(r);
  knowledgeRoutes(r);
  automationRoutes(r);
  labRoutes(r);
  return r;
}

export function createDemoServer(now = realScheduler.now()): DemoServer {
  const virtual = new VirtualScheduler(now);
  const store = new DemoStore(virtual);
  const engine = new DemoEngine(store);
  deterministic(0x70, () => {
    seedWorkspace(store, now);
    seedAgents(store, now);
    seedIntegrations(store, now);
    seedMemories(store, now);
    seedFiles(store, now);
    seedAutomations(store, now);
    seedLab(store, now);
    seedActivity(store, now);
    seedHistory(store, engine, virtual, now);
  });
  // From here on everything happens live, on (scaled) real timers.
  store.sched = realScheduler;
  const processing = store.files.find((f) => f.id === PROCESSING_FILE_ID);
  if (processing) processFile(store, processing, 40_000);
  const router = routes();
  const srv: DemoServer = { store, engine, handle: (request) => dispatch(router, srv, request) };
  return srv;
}
