// ── CRM Adapter ──────────────────────────────────────────────────────────────
// Interface + GoHighLevel implementation for contact/deal/note operations.

import { createLogger } from '@voxvidia/shared';

const logger = createLogger('orchestrator:crm');

// ── Domain Types ────────────────────────────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  company?: string;
  title?: string;
  tags?: string[];
}

export interface AccountSummary {
  name: string;
  totalDeals: number;
  openDeals: number;
  totalValue: number;
  lastActivity?: string;
}

export interface Deal {
  id: string;
  name: string;
  company: string;
  value: number;
  stage: string;
  status: 'open' | 'won' | 'lost' | 'abandoned';
}

export interface CreateNotePayload {
  contactId: string;
  note: string;
}

export interface CreateFollowupPayload {
  contactId: string;
  description: string;
  daysOut: number;
}

// ── Interface ───────────────────────────────────────────────────────────────

export interface CrmAdapter {
  findContactByPhone(phone: string): Promise<Contact | null>;
  getAccountSummary(accountId: string): Promise<AccountSummary | null>;
  getOpenDeals(contactId?: string): Promise<Deal[]>;
  createNote(contactId: string, note: string): Promise<{ id: string }>;
  createFollowupTask(contactId: string, payload: CreateFollowupPayload): Promise<{ id: string }>;
}

// ── Stub Implementation ─────────────────────────────────────────────────────

export class StubCrmAdapter implements CrmAdapter {
  private mockContacts: Contact[] = [
    {
      id: 'contact-001',
      name: 'John Smith',
      phone: '+15551234567',
      email: 'john@acmecorp.com',
      company: 'Acme Corp',
      title: 'VP of Sales',
      tags: ['hot-lead', 'enterprise'],
    },
    {
      id: 'contact-002',
      name: 'Lisa Chen',
      phone: '+15559876543',
      email: 'lisa@betacorp.com',
      company: 'Beta Corp',
      title: 'Director of Operations',
      tags: ['warm-lead'],
    },
  ];

  private mockDeals: Deal[] = [
    {
      id: 'deal-001',
      name: 'Acme Enterprise Package',
      company: 'Acme Corp',
      value: 50_000,
      stage: 'Proposal Sent',
      status: 'open',
    },
    {
      id: 'deal-002',
      name: 'Beta Corp Starter',
      company: 'Beta Corp',
      value: 25_000,
      stage: 'Discovery',
      status: 'open',
    },
  ];

  async findContactByPhone(phone: string): Promise<Contact | null> {
    const digits = phone.replace(/\D/g, '');
    return this.mockContacts.find((c) =>
      c.phone?.replace(/\D/g, '').includes(digits)
    ) ?? null;
  }

  async getAccountSummary(_accountId: string): Promise<AccountSummary> {
    return {
      name: 'Acme Corp',
      totalDeals: 5,
      openDeals: 2,
      totalValue: 150_000,
      lastActivity: 'yesterday',
    };
  }

  async getOpenDeals(_contactId?: string): Promise<Deal[]> {
    return this.mockDeals.filter((d) => d.status === 'open');
  }

  async createNote(_contactId: string, _note: string): Promise<{ id: string }> {
    return { id: `note-${Date.now()}` };
  }

  async createFollowupTask(
    _contactId: string,
    _payload: CreateFollowupPayload,
  ): Promise<{ id: string }> {
    return { id: `task-${Date.now()}` };
  }
}

// ── GoHighLevel Implementation ──────────────────────────────────────────────

export interface GhlConfig {
  baseUrl: string;
  apiKey: string;
  locationId?: string;
}

export class GhlCrmAdapter implements CrmAdapter {
  private baseUrl: string;
  private apiKey: string;
  private locationId: string;

  constructor(config: GhlConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.locationId = config.locationId ?? '';
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Version: '2021-07-28',
        ...(options?.headers as Record<string, string> ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error(`GHL API error: ${res.status} ${path}`, { body });
      throw new Error(`GHL API returned ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  async findContactByPhone(phone: string): Promise<Contact | null> {
    try {
      const digits = phone.replace(/\D/g, '');

      interface GhlSearchResponse {
        contacts: Array<{
          id: string;
          firstName?: string;
          lastName?: string;
          phone?: string;
          email?: string;
          companyName?: string;
          tags?: string[];
        }>;
      }

      const data = await this.request<GhlSearchResponse>(
        `/contacts/search?query=${encodeURIComponent(digits)}&locationId=${this.locationId}`,
      );

      const match = data.contacts?.[0];
      if (!match) return null;

      return {
        id: match.id,
        name: [match.firstName, match.lastName].filter(Boolean).join(' ') || 'Unknown',
        phone: match.phone,
        email: match.email,
        company: match.companyName,
        tags: match.tags,
      };
    } catch (err) {
      logger.error('findContactByPhone failed', { phone, error: String(err) });
      return null;
    }
  }

  async getAccountSummary(accountId: string): Promise<AccountSummary | null> {
    try {
      interface GhlContactResponse {
        contact: {
          firstName?: string;
          lastName?: string;
          companyName?: string;
        };
      }

      const contactData = await this.request<GhlContactResponse>(
        `/contacts/${accountId}`,
      );

      interface GhlPipelineResponse {
        opportunities: Array<{
          status: string;
          monetaryValue?: number;
        }>;
      }

      const pipelineData = await this.request<GhlPipelineResponse>(
        `/opportunities/search?contactId=${accountId}&locationId=${this.locationId}`,
      );

      const opps = pipelineData.opportunities ?? [];
      const openOpps = opps.filter((o) => o.status === 'open');

      return {
        name: contactData.contact?.companyName
          ?? [contactData.contact?.firstName, contactData.contact?.lastName].filter(Boolean).join(' ')
          ?? 'Unknown',
        totalDeals: opps.length,
        openDeals: openOpps.length,
        totalValue: opps.reduce((sum, o) => sum + (o.monetaryValue ?? 0), 0),
      };
    } catch (err) {
      logger.error('getAccountSummary failed', { accountId, error: String(err) });
      return null;
    }
  }

  async getOpenDeals(contactId?: string): Promise<Deal[]> {
    try {
      const query = contactId
        ? `contactId=${contactId}&locationId=${this.locationId}&status=open`
        : `locationId=${this.locationId}&status=open`;

      interface GhlOppsResponse {
        opportunities: Array<{
          id: string;
          name?: string;
          contactName?: string;
          monetaryValue?: number;
          pipelineStageId?: string;
          status: string;
        }>;
      }

      const data = await this.request<GhlOppsResponse>(
        `/opportunities/search?${query}`,
      );

      return (data.opportunities ?? []).map((o) => ({
        id: o.id,
        name: o.name ?? 'Untitled Deal',
        company: o.contactName ?? 'Unknown',
        value: o.monetaryValue ?? 0,
        stage: o.pipelineStageId ?? 'Unknown',
        status: o.status as Deal['status'],
      }));
    } catch (err) {
      logger.error('getOpenDeals failed', { contactId, error: String(err) });
      return [];
    }
  }

  async createNote(contactId: string, note: string): Promise<{ id: string }> {
    try {
      interface GhlNoteResponse {
        id: string;
      }

      const data = await this.request<GhlNoteResponse>(
        `/contacts/${contactId}/notes`,
        {
          method: 'POST',
          body: JSON.stringify({ body: note }),
        },
      );

      return { id: data.id };
    } catch (err) {
      logger.error('createNote failed', { contactId, error: String(err) });
      return { id: '' };
    }
  }

  async createFollowupTask(
    contactId: string,
    payload: CreateFollowupPayload,
  ): Promise<{ id: string }> {
    try {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + payload.daysOut);

      interface GhlTaskResponse {
        id: string;
      }

      const data = await this.request<GhlTaskResponse>(
        `/contacts/${contactId}/tasks`,
        {
          method: 'POST',
          body: JSON.stringify({
            title: `Follow-up: ${payload.description.slice(0, 80)}`,
            body: payload.description,
            dueDate: dueDate.toISOString(),
            completed: false,
          }),
        },
      );

      return { id: data.id };
    } catch (err) {
      logger.error('createFollowupTask failed', { contactId, error: String(err) });
      return { id: '' };
    }
  }
}
