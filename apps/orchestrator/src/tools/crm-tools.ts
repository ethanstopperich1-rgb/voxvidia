// ── CRM Tool Handlers ────────────────────────────────────────────────────────
// Registers tool handlers that bridge the ToolRegistry to CrmAdapter.

import type { ToolRegistry } from '../tool-runner.js';
import type { CrmAdapter } from '../adapters/crm.js';

export function registerCrmTools(
  registry: ToolRegistry,
  adapter: CrmAdapter,
): void {
  registry.register('find_contact_by_phone', async (args) => {
    const phone = (args.phone as string) ?? '';
    if (!phone) {
      throw new Error('find_contact_by_phone requires a phone number');
    }
    return adapter.findContactByPhone(phone);
  });

  registry.register('get_account_summary', async (args) => {
    const accountId = (args.accountId as string) ?? '';
    if (!accountId) {
      throw new Error('get_account_summary requires an accountId');
    }
    return adapter.getAccountSummary(accountId);
  });

  registry.register('get_open_deals', async (args) => {
    const contactId = (args.contactId as string) ?? undefined;
    return adapter.getOpenDeals(contactId);
  });

  registry.register('create_crm_note', async (args) => {
    const contactId = (args.contactId as string) ?? '';
    const note = (args.note as string) ?? '';
    if (!note) {
      throw new Error('create_crm_note requires a note');
    }
    return adapter.createNote(contactId, note);
  });

  registry.register('create_followup_task', async (args) => {
    const contactId = (args.contactId as string) ?? '';
    const description = (args.description as string) ?? '';
    const daysOut = (args.daysOut as number) ?? 1;

    return adapter.createFollowupTask(contactId, {
      contactId,
      description,
      daysOut,
    });
  });
}
