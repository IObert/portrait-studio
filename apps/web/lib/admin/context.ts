import "server-only";
import { EventRepo } from "../events/repo";
import type { DeleteHooks } from "../events/delete";
import { getServices } from "../services";

let events: EventRepo | undefined;
let ready: Promise<void> | undefined;

/** Event repository bound to the shared Sync store; the `events` map is created on first use. */
export async function getEventRepo(): Promise<EventRepo> {
  events ??= new EventRepo(getServices().sync);
  ready ??= events.init().catch((err) => {
    ready = undefined;
    throw err;
  });
  await ready;
  return events;
}

/**
 * TODO(milestone e): bindings and Conversation Memory clean-up. Until the
 * attendee flow exists there are no bindings or profile links for an event.
 */
export const deleteHooks: DeleteHooks = {
  async removeBindings() {},
  async unlinkProfiles() {},
};
