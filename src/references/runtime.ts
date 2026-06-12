import { ReferenceCoordinator } from "./coordinator";
import { ReferenceStore } from "./store";

let store: ReferenceStore | null = null;
let coordinator: ReferenceCoordinator | null = null;

export function getReferenceCoordinator(): ReferenceCoordinator {
  if (!coordinator) {
    store = new ReferenceStore(
      process.env.REFERENCE_DB_PATH ?? "./reference-workflow.db"
    );
    coordinator = new ReferenceCoordinator(
      store,
      Number.parseInt(process.env.REFERENCE_TIMEOUT_MINUTES ?? "30", 10)
    );
  }
  return coordinator;
}
