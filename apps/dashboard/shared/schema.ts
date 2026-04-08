import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Voice calls table
export const voiceCalls = sqliteTable("voice_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  callerName: text("caller_name").notNull(),
  callerPhone: text("caller_phone").notNull(),
  direction: text("direction").notNull(), // inbound | outbound
  duration: integer("duration").notNull(), // seconds
  outcome: text("outcome").notNull(), // appointment_set | follow_up | declined | transferred | no_answer
  sentiment: text("sentiment").notNull(), // positive | neutral | negative
  cost: real("cost").notNull(),
  vehicle: text("vehicle"),
  appointmentType: text("appointment_type"),
  transcript: text("transcript"), // JSON string of messages
  timestamp: text("timestamp").notNull(),
  agentName: text("agent_name").notNull(),
});

export const insertVoiceCallSchema = createInsertSchema(voiceCalls).omit({ id: true });
export type InsertVoiceCall = z.infer<typeof insertVoiceCallSchema>;
export type VoiceCall = typeof voiceCalls.$inferSelect;

// Campaigns table
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull(), // active | completed | draft
  piecesMailed: integer("pieces_mailed").notNull(),
  qrScans: integer("qr_scans").notNull(),
  conversationsStarted: integer("conversations_started").notNull(),
  appointmentsBooked: integer("appointments_booked").notNull(),
  appointmentsKept: integer("appointments_kept").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
});

export const insertCampaignSchema = createInsertSchema(campaigns).omit({ id: true });
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaigns.$inferSelect;

// Appointments table
export const appointments = sqliteTable("appointments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerName: text("customer_name").notNull(),
  customerPhone: text("customer_phone").notNull(),
  vehicle: text("vehicle"),
  source: text("source").notNull(), // voice_ai | talking_postcard
  type: text("type").notNull(), // service | sales | appraisal
  status: text("status").notNull(), // scheduled | confirmed | completed | no_show
  dateTime: text("date_time").notNull(),
  crmSync: text("crm_sync").notNull(), // synced | pending | failed
});

export const insertAppointmentSchema = createInsertSchema(appointments).omit({ id: true });
export type InsertAppointment = z.infer<typeof insertAppointmentSchema>;
export type Appointment = typeof appointments.$inferSelect;
