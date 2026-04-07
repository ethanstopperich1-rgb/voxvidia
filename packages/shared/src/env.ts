import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.string().default('development'),
  PERSONAPLEX_WS_URL: z.string().default('ws://localhost:8998/api/chat'),
  DEFAULT_VOICE: z.string().default('NATF2.pt'),
  DEFAULT_PROMPT: z.string().default('You enjoy having a good conversation. You are friendly and helpful.'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM_NUMBER: z.string().optional(),

  // Supabase
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_KEY: z.string().optional(),

  // CRM
  CRM_BASE_URL: z.string().optional(),
  CRM_API_KEY: z.string().optional(),

  // Google Calendar
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),

  // Adapter toggle
  USE_STUB_ADAPTERS: z.string().default('true'),

  // Agent identity (used in enriched outbound prompts)
  AGENT_NAME: z.string().optional(),
  COMPANY_NAME: z.string().optional(),

  // Outbound webhooks
  OUTBOUND_CRM_WEBHOOK_URL: z.string().optional(),
  OUTBOUND_ANALYTICS_WEBHOOK_URL: z.string().optional(),
  OUTBOUND_SLACK_WEBHOOK_URL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
