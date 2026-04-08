// ==========================================
// VoxVidia Mock Data — Orlando Motors
// Tells the story: AI answering 24/7, catching after-hours leads,
// booking at 2x traditional BDC rate
// ==========================================

export interface VoiceCall {
  id: number;
  callerName: string;
  callerPhone: string;
  direction: "inbound" | "outbound";
  duration: number; // seconds
  outcome: "appointment_set" | "follow_up" | "declined" | "transferred" | "no_answer";
  sentiment: "positive" | "neutral" | "negative";
  cost: number;
  vehicle: string;
  appointmentType: string;
  transcript: TranscriptMessage[];
  timestamp: string;
  agentName: string;
}

export interface TranscriptMessage {
  speaker: "Maria" | "Caller";
  text: string;
  timestamp: string;
  toolCall?: { name: string; args: string; result: string };
}

export interface Campaign {
  id: number;
  name: string;
  status: "active" | "completed" | "draft";
  piecesMailed: number;
  qrScans: number;
  conversationsStarted: number;
  appointmentsBooked: number;
  appointmentsKept: number;
  startDate: string;
  endDate: string | null;
  scanData: number[]; // daily scans over time
}

export interface Appointment {
  id: number;
  customerName: string;
  customerPhone: string;
  vehicle: string;
  source: "voice_ai" | "talking_postcard";
  type: "service" | "sales" | "appraisal";
  status: "scheduled" | "confirmed" | "completed" | "no_show";
  dateTime: string;
  crmSync: "synced" | "pending" | "failed";
}

export interface ActivityItem {
  id: number;
  message: string;
  timestamp: string;
  type: "appointment" | "scan" | "transfer" | "call";
}

// ==========================================
// VOICE CALLS (47 calls today — strong day)
// ==========================================

const transcriptSample1: TranscriptMessage[] = [
  { speaker: "Maria", text: "Thank you for calling Orlando Motors, this is Maria, your virtual assistant. How can I help you today?", timestamp: "2:14 PM" },
  { speaker: "Caller", text: "Hi, I need to schedule an oil change for my Camry.", timestamp: "2:14 PM" },
  { speaker: "Maria", text: "I'd be happy to help you schedule that! Can I get your name please?", timestamp: "2:14 PM" },
  { speaker: "Caller", text: "It's John Delgado.", timestamp: "2:15 PM" },
  { speaker: "Maria", text: "Thank you, John. And what year is your Toyota Camry?", timestamp: "2:15 PM" },
  { speaker: "Caller", text: "2022.", timestamp: "2:15 PM" },
  { speaker: "Maria", text: "Perfect. I have availability tomorrow at 9:30 AM or Thursday at 2:00 PM. Which works better for you?", timestamp: "2:15 PM" },
  { speaker: "Caller", text: "Tomorrow at 9:30 works great.", timestamp: "2:15 PM" },
  { speaker: "Maria", text: "Excellent! I've booked your oil change for tomorrow, Wednesday, at 9:30 AM. You'll receive a confirmation text shortly. Is there anything else I can help with?", timestamp: "2:16 PM",
    toolCall: { name: "book_appointment", args: '{"customer":"John Delgado","type":"oil_change","datetime":"2025-01-15T09:30:00","vehicle":"2022 Toyota Camry"}', result: "Appointment confirmed — ID #4521" }
  },
  { speaker: "Caller", text: "No, that's it. Thanks!", timestamp: "2:16 PM" },
  { speaker: "Maria", text: "You're welcome, John! We'll see you tomorrow. Have a great day!", timestamp: "2:16 PM" },
];

const transcriptSample2: TranscriptMessage[] = [
  { speaker: "Maria", text: "Thank you for calling Orlando Motors, this is Maria. How can I assist you today?", timestamp: "10:47 PM" },
  { speaker: "Caller", text: "Yeah hi, I saw your ad for the F-150. Is it still available?", timestamp: "10:47 PM" },
  { speaker: "Maria", text: "We have several F-150 models in stock! Are you looking for a new or pre-owned vehicle?", timestamp: "10:47 PM" },
  { speaker: "Caller", text: "Used, maybe 2022 or 2023. Under 40K.", timestamp: "10:48 PM" },
  { speaker: "Maria", text: "Great news — we currently have three pre-owned F-150s that fit your criteria. I'd love to schedule a time for you to come see them. Would tomorrow afternoon work?", timestamp: "10:48 PM" },
  { speaker: "Caller", text: "Yeah, I could do 4 PM.", timestamp: "10:48 PM" },
  { speaker: "Maria", text: "Perfect! I've scheduled a test drive appointment for tomorrow at 4:00 PM. Can I get your name?", timestamp: "10:48 PM" },
  { speaker: "Caller", text: "Marcus Williams.", timestamp: "10:49 PM" },
  { speaker: "Maria", text: "Wonderful, Marcus. You're all set for tomorrow at 4 PM. One of our sales consultants will have the vehicles ready for you. See you then!", timestamp: "10:49 PM",
    toolCall: { name: "book_appointment", args: '{"customer":"Marcus Williams","type":"test_drive","datetime":"2025-01-15T16:00:00","vehicle":"Ford F-150"}', result: "Appointment confirmed — ID #4523" }
  },
];

const transcriptSample3: TranscriptMessage[] = [
  { speaker: "Maria", text: "Good morning, Orlando Motors — this is Maria. How may I help you?", timestamp: "8:22 AM" },
  { speaker: "Caller", text: "I got a recall notice for my Tucson. Need to schedule that.", timestamp: "8:22 AM" },
  { speaker: "Maria", text: "Of course. I can help you schedule your recall service. May I have your name?", timestamp: "8:22 AM" },
  { speaker: "Caller", text: "Patricia Chen.", timestamp: "8:23 AM" },
  { speaker: "Maria", text: "Thank you, Patricia. What year is your Hyundai Tucson?", timestamp: "8:23 AM" },
  { speaker: "Caller", text: "2021.", timestamp: "8:23 AM" },
  { speaker: "Maria", text: "I see that recall — it's for the engine control module update. It takes about 45 minutes. I have Friday at 10 AM or next Monday at 8 AM available.", timestamp: "8:23 PM" },
  { speaker: "Caller", text: "Friday at 10 is fine.", timestamp: "8:24 AM" },
  { speaker: "Maria", text: "You're all set, Patricia. Friday at 10 AM for your recall service. We'll text you a reminder.", timestamp: "8:24 AM",
    toolCall: { name: "book_appointment", args: '{"customer":"Patricia Chen","type":"recall_service","datetime":"2025-01-17T10:00:00","vehicle":"2021 Hyundai Tucson"}', result: "Appointment confirmed — ID #4518" }
  },
];

export const voiceCalls: VoiceCall[] = [
  { id: 1, callerName: "John Delgado", callerPhone: "(407) 555-0134", direction: "inbound", duration: 127, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2022 Toyota Camry", appointmentType: "Oil Change", transcript: transcriptSample1, timestamp: "2025-01-14T14:14:00", agentName: "Maria" },
  { id: 2, callerName: "Marcus Williams", callerPhone: "(321) 555-0287", direction: "inbound", duration: 156, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Ford F-150", appointmentType: "Test Drive", transcript: transcriptSample2, timestamp: "2025-01-14T22:47:00", agentName: "Maria" },
  { id: 3, callerName: "Patricia Chen", callerPhone: "(407) 555-0392", direction: "inbound", duration: 98, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2021 Hyundai Tucson", appointmentType: "Recall Service", transcript: transcriptSample3, timestamp: "2025-01-14T08:22:00", agentName: "Maria" },
  { id: 4, callerName: "Angela Ramirez", callerPhone: "(689) 555-0145", direction: "inbound", duration: 203, outcome: "appointment_set", sentiment: "positive", cost: 0.04, vehicle: "2020 Honda Civic", appointmentType: "Brake Service", transcript: transcriptSample1, timestamp: "2025-01-14T09:15:00", agentName: "Maria" },
  { id: 5, callerName: "David Thompson", callerPhone: "(407) 555-0678", direction: "inbound", duration: 45, outcome: "transferred", sentiment: "neutral", cost: 0.01, vehicle: "2019 Chevy Silverado", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T10:03:00", agentName: "Maria" },
  { id: 6, callerName: "Keisha Bryant", callerPhone: "(321) 555-0891", direction: "inbound", duration: 167, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Toyota RAV4", appointmentType: "Tire Rotation", transcript: transcriptSample1, timestamp: "2025-01-14T10:30:00", agentName: "Maria" },
  { id: 7, callerName: "Robert Nguyen", callerPhone: "(407) 555-0234", direction: "outbound", duration: 0, outcome: "no_answer", sentiment: "neutral", cost: 0.00, vehicle: "2021 Honda Accord", appointmentType: "", transcript: [], timestamp: "2025-01-14T11:00:00", agentName: "Maria" },
  { id: 8, callerName: "Samantha O'Brien", callerPhone: "(689) 555-0567", direction: "inbound", duration: 234, outcome: "appointment_set", sentiment: "positive", cost: 0.04, vehicle: "2022 Ford Explorer", appointmentType: "30K Service", transcript: transcriptSample1, timestamp: "2025-01-14T11:22:00", agentName: "Maria" },
  { id: 9, callerName: "Carlos Mendez", callerPhone: "(407) 555-0901", direction: "inbound", duration: 89, outcome: "declined", sentiment: "negative", cost: 0.02, vehicle: "2018 Nissan Altima", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T11:45:00", agentName: "Maria" },
  { id: 10, callerName: "Jessica Park", callerPhone: "(321) 555-0432", direction: "inbound", duration: 145, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Hyundai Santa Fe", appointmentType: "Test Drive", transcript: transcriptSample1, timestamp: "2025-01-14T12:10:00", agentName: "Maria" },
  { id: 11, callerName: "Michael Foster", callerPhone: "(407) 555-0765", direction: "inbound", duration: 178, outcome: "follow_up", sentiment: "neutral", cost: 0.03, vehicle: "2020 Chevy Equinox", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T12:45:00", agentName: "Maria" },
  { id: 12, callerName: "Aisha Johnson", callerPhone: "(689) 555-0234", direction: "inbound", duration: 112, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2022 Toyota Corolla", appointmentType: "Oil Change", transcript: transcriptSample1, timestamp: "2025-01-14T13:15:00", agentName: "Maria" },
  { id: 13, callerName: "Derek Washington", callerPhone: "(407) 555-0543", direction: "outbound", duration: 189, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2021 Ford Bronco", appointmentType: "Appraisal", transcript: transcriptSample1, timestamp: "2025-01-14T13:40:00", agentName: "Maria" },
  { id: 14, callerName: "Maria Santos", callerPhone: "(321) 555-0876", direction: "inbound", duration: 67, outcome: "transferred", sentiment: "neutral", cost: 0.01, vehicle: "2023 Honda CR-V", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T14:55:00", agentName: "Maria" },
  { id: 15, callerName: "Brian Kelly", callerPhone: "(407) 555-0198", direction: "inbound", duration: 134, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2019 Toyota Tacoma", appointmentType: "Brake Service", transcript: transcriptSample1, timestamp: "2025-01-14T15:20:00", agentName: "Maria" },
  { id: 16, callerName: "Natasha Petrov", callerPhone: "(689) 555-0432", direction: "inbound", duration: 198, outcome: "appointment_set", sentiment: "positive", cost: 0.04, vehicle: "2022 Lexus RX 350", appointmentType: "Test Drive", transcript: transcriptSample1, timestamp: "2025-01-14T15:50:00", agentName: "Maria" },
  { id: 17, callerName: "James Rodriguez", callerPhone: "(407) 555-0654", direction: "inbound", duration: 56, outcome: "declined", sentiment: "negative", cost: 0.01, vehicle: "2017 Nissan Rogue", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T16:10:00", agentName: "Maria" },
  { id: 18, callerName: "Lily Zhang", callerPhone: "(321) 555-0321", direction: "inbound", duration: 143, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Tesla Model Y", appointmentType: "Appraisal", transcript: transcriptSample1, timestamp: "2025-01-14T16:35:00", agentName: "Maria" },
  { id: 19, callerName: "Thomas Mitchell", callerPhone: "(407) 555-0876", direction: "outbound", duration: 201, outcome: "appointment_set", sentiment: "positive", cost: 0.04, vehicle: "2020 Ford F-150", appointmentType: "Buyback Offer", transcript: transcriptSample1, timestamp: "2025-01-14T17:00:00", agentName: "Maria" },
  { id: 20, callerName: "Priya Sharma", callerPhone: "(689) 555-0654", direction: "inbound", duration: 167, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2022 Honda Pilot", appointmentType: "60K Service", transcript: transcriptSample1, timestamp: "2025-01-14T17:30:00", agentName: "Maria" },
  // After hours calls — showing AI advantage
  { id: 21, callerName: "Kevin Moore", callerPhone: "(407) 555-0111", direction: "inbound", duration: 134, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2023 Chevy Traverse", appointmentType: "Test Drive", transcript: transcriptSample2, timestamp: "2025-01-14T18:15:00", agentName: "Maria" },
  { id: 22, callerName: "Rachel Kim", callerPhone: "(321) 555-0222", direction: "inbound", duration: 189, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2022 Toyota Highlander", appointmentType: "Oil Change", transcript: transcriptSample2, timestamp: "2025-01-14T19:00:00", agentName: "Maria" },
  { id: 23, callerName: "Andre Jackson", callerPhone: "(689) 555-0333", direction: "inbound", duration: 156, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2021 Ford Mustang", appointmentType: "Test Drive", transcript: transcriptSample2, timestamp: "2025-01-14T19:45:00", agentName: "Maria" },
  { id: 24, callerName: "Sofia Hernandez", callerPhone: "(407) 555-0444", direction: "inbound", duration: 178, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Hyundai Palisade", appointmentType: "Appraisal", transcript: transcriptSample2, timestamp: "2025-01-14T20:10:00", agentName: "Maria" },
  { id: 25, callerName: "Daniel Cooper", callerPhone: "(321) 555-0555", direction: "inbound", duration: 123, outcome: "follow_up", sentiment: "neutral", cost: 0.02, vehicle: "2020 Honda Odyssey", appointmentType: "", transcript: transcriptSample2, timestamp: "2025-01-14T20:40:00", agentName: "Maria" },
  { id: 26, callerName: "Tanya Brooks", callerPhone: "(689) 555-0666", direction: "inbound", duration: 145, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2022 Chevy Malibu", appointmentType: "Recall Service", transcript: transcriptSample2, timestamp: "2025-01-14T21:15:00", agentName: "Maria" },
  { id: 27, callerName: "Hassan Ali", callerPhone: "(407) 555-0777", direction: "inbound", duration: 167, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Toyota Supra", appointmentType: "Test Drive", transcript: transcriptSample2, timestamp: "2025-01-14T21:50:00", agentName: "Maria" },
  { id: 28, callerName: "Emily Watson", callerPhone: "(321) 555-0888", direction: "inbound", duration: 98, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2021 Ford Edge", appointmentType: "Tire Rotation", transcript: transcriptSample2, timestamp: "2025-01-14T22:20:00", agentName: "Maria" },
  { id: 29, callerName: "Victor Reyes", callerPhone: "(407) 555-0999", direction: "inbound", duration: 134, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2022 Honda HR-V", appointmentType: "Oil Change", transcript: transcriptSample2, timestamp: "2025-01-14T23:05:00", agentName: "Maria" },
  { id: 30, callerName: "Nina Volkov", callerPhone: "(689) 555-0112", direction: "inbound", duration: 156, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Lexus NX", appointmentType: "Test Drive", transcript: transcriptSample2, timestamp: "2025-01-14T23:30:00", agentName: "Maria" },
  // Early morning AI catches
  { id: 31, callerName: "Chris Taylor", callerPhone: "(407) 555-1234", direction: "inbound", duration: 112, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2022 Chevy Colorado", appointmentType: "Oil Change", transcript: transcriptSample2, timestamp: "2025-01-14T05:30:00", agentName: "Maria" },
  { id: 32, callerName: "Diana Okafor", callerPhone: "(321) 555-2345", direction: "inbound", duration: 145, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2021 Toyota Sienna", appointmentType: "Brake Service", transcript: transcriptSample2, timestamp: "2025-01-14T06:15:00", agentName: "Maria" },
  { id: 33, callerName: "Ryan Murphy", callerPhone: "(689) 555-3456", direction: "inbound", duration: 89, outcome: "follow_up", sentiment: "neutral", cost: 0.02, vehicle: "2020 Ford Ranger", appointmentType: "", transcript: transcriptSample2, timestamp: "2025-01-14T06:45:00", agentName: "Maria" },
  // More business hours calls
  { id: 34, callerName: "Lauren Phillips", callerPhone: "(407) 555-4567", direction: "inbound", duration: 178, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2023 Honda Accord", appointmentType: "Test Drive", transcript: transcriptSample1, timestamp: "2025-01-14T07:30:00", agentName: "Maria" },
  { id: 35, callerName: "Omar Hassan", callerPhone: "(321) 555-5678", direction: "outbound", duration: 0, outcome: "no_answer", sentiment: "neutral", cost: 0.00, vehicle: "2019 Nissan Pathfinder", appointmentType: "", transcript: [], timestamp: "2025-01-14T07:45:00", agentName: "Maria" },
  { id: 36, callerName: "Stephanie Lee", callerPhone: "(689) 555-6789", direction: "inbound", duration: 201, outcome: "appointment_set", sentiment: "positive", cost: 0.04, vehicle: "2022 Hyundai Elantra", appointmentType: "30K Service", transcript: transcriptSample1, timestamp: "2025-01-14T08:50:00", agentName: "Maria" },
  { id: 37, callerName: "William Brown", callerPhone: "(407) 555-7890", direction: "inbound", duration: 67, outcome: "transferred", sentiment: "neutral", cost: 0.01, vehicle: "2023 Chevy Tahoe", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T09:40:00", agentName: "Maria" },
  { id: 38, callerName: "Ashley Davis", callerPhone: "(321) 555-8901", direction: "inbound", duration: 145, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2021 Toyota Camry", appointmentType: "Oil Change", transcript: transcriptSample1, timestamp: "2025-01-14T10:55:00", agentName: "Maria" },
  { id: 39, callerName: "Jerome Wilson", callerPhone: "(689) 555-9012", direction: "inbound", duration: 156, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2022 Ford Escape", appointmentType: "Tire Rotation", transcript: transcriptSample1, timestamp: "2025-01-14T11:30:00", agentName: "Maria" },
  { id: 40, callerName: "Megan Clark", callerPhone: "(407) 555-0345", direction: "inbound", duration: 189, outcome: "follow_up", sentiment: "positive", cost: 0.03, vehicle: "2023 Honda Passport", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T12:20:00", agentName: "Maria" },
  { id: 41, callerName: "Anthony Garcia", callerPhone: "(321) 555-0456", direction: "outbound", duration: 134, outcome: "appointment_set", sentiment: "positive", cost: 0.02, vehicle: "2020 Toyota Tundra", appointmentType: "Buyback Offer", transcript: transcriptSample1, timestamp: "2025-01-14T13:00:00", agentName: "Maria" },
  { id: 42, callerName: "Brittany Evans", callerPhone: "(689) 555-0987", direction: "inbound", duration: 167, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2022 Hyundai Kona", appointmentType: "Test Drive", transcript: transcriptSample1, timestamp: "2025-01-14T14:30:00", agentName: "Maria" },
  { id: 43, callerName: "Jason Turner", callerPhone: "(407) 555-1111", direction: "inbound", duration: 78, outcome: "declined", sentiment: "negative", cost: 0.01, vehicle: "2018 Chevy Cruze", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T15:00:00", agentName: "Maria" },
  { id: 44, callerName: "Christina Diaz", callerPhone: "(321) 555-2222", direction: "inbound", duration: 198, outcome: "appointment_set", sentiment: "positive", cost: 0.04, vehicle: "2023 Ford Bronco Sport", appointmentType: "Test Drive", transcript: transcriptSample1, timestamp: "2025-01-14T16:00:00", agentName: "Maria" },
  { id: 45, callerName: "Nathan Scott", callerPhone: "(689) 555-3333", direction: "inbound", duration: 145, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2021 Honda Civic", appointmentType: "Brake Service", transcript: transcriptSample1, timestamp: "2025-01-14T16:45:00", agentName: "Maria" },
  { id: 46, callerName: "Gabriela Torres", callerPhone: "(407) 555-4444", direction: "inbound", duration: 112, outcome: "follow_up", sentiment: "neutral", cost: 0.02, vehicle: "2022 Toyota RAV4 Prime", appointmentType: "", transcript: transcriptSample1, timestamp: "2025-01-14T17:15:00", agentName: "Maria" },
  { id: 47, callerName: "Paul Anderson", callerPhone: "(321) 555-5555", direction: "outbound", duration: 167, outcome: "appointment_set", sentiment: "positive", cost: 0.03, vehicle: "2020 Ford F-250", appointmentType: "Buyback Offer", transcript: transcriptSample1, timestamp: "2025-01-14T17:45:00", agentName: "Maria" },
];

// ==========================================
// CALL VOLUME BY HOUR (shows after-hours advantage)
// ==========================================
export const callVolumeByHour = [
  { hour: "12 AM", calls: 1, afterHours: true },
  { hour: "1 AM", calls: 0, afterHours: true },
  { hour: "2 AM", calls: 0, afterHours: true },
  { hour: "3 AM", calls: 0, afterHours: true },
  { hour: "4 AM", calls: 0, afterHours: true },
  { hour: "5 AM", calls: 1, afterHours: true },
  { hour: "6 AM", calls: 2, afterHours: true },
  { hour: "7 AM", calls: 2, afterHours: false },
  { hour: "8 AM", calls: 3, afterHours: false },
  { hour: "9 AM", calls: 3, afterHours: false },
  { hour: "10 AM", calls: 4, afterHours: false },
  { hour: "11 AM", calls: 3, afterHours: false },
  { hour: "12 PM", calls: 3, afterHours: false },
  { hour: "1 PM", calls: 4, afterHours: false },
  { hour: "2 PM", calls: 3, afterHours: false },
  { hour: "3 PM", calls: 3, afterHours: false },
  { hour: "4 PM", calls: 3, afterHours: false },
  { hour: "5 PM", calls: 3, afterHours: false },
  { hour: "6 PM", calls: 2, afterHours: true },
  { hour: "7 PM", calls: 2, afterHours: true },
  { hour: "8 PM", calls: 2, afterHours: true },
  { hour: "9 PM", calls: 2, afterHours: true },
  { hour: "10 PM", calls: 3, afterHours: true },
  { hour: "11 PM", calls: 2, afterHours: true },
];

// ==========================================
// CONVERSION FUNNEL
// ==========================================
export const conversionFunnel = [
  { stage: "Calls Received", value: 47, percentage: 100 },
  { stage: "Connected", value: 42, percentage: 89 },
  { stage: "Qualified", value: 38, percentage: 81 },
  { stage: "Appointment Set", value: 32, percentage: 68 },
  { stage: "Appointment Kept", value: 25, percentage: 53 },
];

// ==========================================
// CAMPAIGNS
// ==========================================
export const campaigns: Campaign[] = [
  {
    id: 1,
    name: "March Buyback Blitz",
    status: "active",
    piecesMailed: 4500,
    qrScans: 387,
    conversationsStarted: 234,
    appointmentsBooked: 89,
    appointmentsKept: 67,
    startDate: "2025-03-01",
    endDate: null,
    scanData: [12, 18, 25, 31, 28, 22, 15, 19, 24, 32, 29, 18, 14, 21, 27, 34, 28, 22, 16, 20, 26, 33, 30, 19, 15, 23, 28, 35, 31, 24],
  },
  {
    id: 2,
    name: "Winter Service Special",
    status: "completed",
    piecesMailed: 3200,
    qrScans: 256,
    conversationsStarted: 178,
    appointmentsBooked: 72,
    appointmentsKept: 58,
    startDate: "2025-01-15",
    endDate: "2025-02-15",
    scanData: [8, 12, 15, 20, 18, 14, 10, 13, 17, 22, 19, 12, 9, 14, 18, 21, 16, 11, 8, 12, 15, 19, 17, 10, 7, 11, 14, 18, 15, 9],
  },
  {
    id: 3,
    name: "Q2 Lease Return Outreach",
    status: "draft",
    piecesMailed: 0,
    qrScans: 0,
    conversationsStarted: 0,
    appointmentsBooked: 0,
    appointmentsKept: 0,
    startDate: "2025-04-01",
    endDate: null,
    scanData: [],
  },
  {
    id: 4,
    name: "Holiday Trade-In Event",
    status: "completed",
    piecesMailed: 5000,
    qrScans: 412,
    conversationsStarted: 289,
    appointmentsBooked: 112,
    appointmentsKept: 87,
    startDate: "2024-12-01",
    endDate: "2024-12-31",
    scanData: [15, 22, 28, 35, 32, 25, 18, 24, 30, 38, 34, 26, 19, 27, 33, 40, 36, 28, 21, 29, 35, 42, 38, 30, 22, 31, 37, 44, 40, 32],
  },
];

// ==========================================
// APPOINTMENTS
// ==========================================
export const appointments: Appointment[] = [
  { id: 1, customerName: "John Delgado", customerPhone: "(407) 555-0134", vehicle: "2022 Toyota Camry", source: "voice_ai", type: "service", status: "confirmed", dateTime: "2025-01-15T09:30:00", crmSync: "synced" },
  { id: 2, customerName: "Marcus Williams", customerPhone: "(321) 555-0287", vehicle: "2023 Ford F-150", source: "voice_ai", type: "sales", status: "scheduled", dateTime: "2025-01-15T16:00:00", crmSync: "synced" },
  { id: 3, customerName: "Patricia Chen", customerPhone: "(407) 555-0392", vehicle: "2021 Hyundai Tucson", source: "voice_ai", type: "service", status: "confirmed", dateTime: "2025-01-17T10:00:00", crmSync: "synced" },
  { id: 4, customerName: "Angela Ramirez", customerPhone: "(689) 555-0145", vehicle: "2020 Honda Civic", source: "voice_ai", type: "service", status: "confirmed", dateTime: "2025-01-15T11:00:00", crmSync: "synced" },
  { id: 5, customerName: "Keisha Bryant", customerPhone: "(321) 555-0891", vehicle: "2023 Toyota RAV4", source: "voice_ai", type: "service", status: "scheduled", dateTime: "2025-01-16T14:00:00", crmSync: "pending" },
  { id: 6, customerName: "Samantha O'Brien", customerPhone: "(689) 555-0567", vehicle: "2022 Ford Explorer", source: "voice_ai", type: "service", status: "confirmed", dateTime: "2025-01-16T09:00:00", crmSync: "synced" },
  { id: 7, customerName: "Jessica Park", customerPhone: "(321) 555-0432", vehicle: "2023 Hyundai Santa Fe", source: "voice_ai", type: "sales", status: "scheduled", dateTime: "2025-01-15T13:00:00", crmSync: "synced" },
  { id: 8, customerName: "Sarah Mitchell", customerPhone: "(407) 555-8765", vehicle: "2019 Toyota Camry", source: "talking_postcard", type: "appraisal", status: "confirmed", dateTime: "2025-01-15T10:30:00", crmSync: "synced" },
  { id: 9, customerName: "Robert Nguyen", customerPhone: "(407) 555-0234", vehicle: "2021 Honda Accord", source: "talking_postcard", type: "appraisal", status: "scheduled", dateTime: "2025-01-16T15:00:00", crmSync: "pending" },
  { id: 10, customerName: "Aisha Johnson", customerPhone: "(689) 555-0234", vehicle: "2022 Toyota Corolla", source: "voice_ai", type: "service", status: "completed", dateTime: "2025-01-14T08:30:00", crmSync: "synced" },
  { id: 11, customerName: "Derek Washington", customerPhone: "(407) 555-0543", vehicle: "2021 Ford Bronco", source: "voice_ai", type: "appraisal", status: "completed", dateTime: "2025-01-14T10:00:00", crmSync: "synced" },
  { id: 12, customerName: "Brian Kelly", customerPhone: "(407) 555-0198", vehicle: "2019 Toyota Tacoma", source: "voice_ai", type: "service", status: "no_show", dateTime: "2025-01-14T14:00:00", crmSync: "synced" },
  { id: 13, customerName: "Natasha Petrov", customerPhone: "(689) 555-0432", vehicle: "2022 Lexus RX 350", source: "voice_ai", type: "sales", status: "completed", dateTime: "2025-01-14T11:30:00", crmSync: "synced" },
  { id: 14, customerName: "Lily Zhang", customerPhone: "(321) 555-0321", vehicle: "2023 Tesla Model Y", source: "voice_ai", type: "appraisal", status: "confirmed", dateTime: "2025-01-16T11:00:00", crmSync: "synced" },
  { id: 15, customerName: "Kevin Moore", customerPhone: "(407) 555-0111", vehicle: "2023 Chevy Traverse", source: "voice_ai", type: "sales", status: "scheduled", dateTime: "2025-01-15T15:00:00", crmSync: "synced" },
  { id: 16, customerName: "Rachel Kim", customerPhone: "(321) 555-0222", vehicle: "2022 Toyota Highlander", source: "voice_ai", type: "service", status: "scheduled", dateTime: "2025-01-17T09:00:00", crmSync: "pending" },
  { id: 17, customerName: "Andre Jackson", customerPhone: "(689) 555-0333", vehicle: "2021 Ford Mustang", source: "voice_ai", type: "sales", status: "scheduled", dateTime: "2025-01-16T16:00:00", crmSync: "synced" },
  { id: 18, customerName: "Sofia Hernandez", customerPhone: "(407) 555-0444", vehicle: "2023 Hyundai Palisade", source: "voice_ai", type: "appraisal", status: "confirmed", dateTime: "2025-01-15T14:00:00", crmSync: "synced" },
  { id: 19, customerName: "Tanya Brooks", customerPhone: "(689) 555-0666", vehicle: "2022 Chevy Malibu", source: "voice_ai", type: "service", status: "scheduled", dateTime: "2025-01-17T13:00:00", crmSync: "synced" },
  { id: 20, customerName: "Hassan Ali", customerPhone: "(407) 555-0777", vehicle: "2023 Toyota Supra", source: "voice_ai", type: "sales", status: "scheduled", dateTime: "2025-01-17T14:00:00", crmSync: "pending" },
  { id: 21, customerName: "Linda Patterson", customerPhone: "(321) 555-1111", vehicle: "2020 Honda CR-V", source: "talking_postcard", type: "appraisal", status: "confirmed", dateTime: "2025-01-16T10:00:00", crmSync: "synced" },
  { id: 22, customerName: "George Martinez", customerPhone: "(689) 555-2222", vehicle: "2019 Ford F-150", source: "talking_postcard", type: "appraisal", status: "completed", dateTime: "2025-01-14T15:30:00", crmSync: "synced" },
  { id: 23, customerName: "Michelle Adams", customerPhone: "(407) 555-3333", vehicle: "2021 Chevy Silverado", source: "talking_postcard", type: "appraisal", status: "scheduled", dateTime: "2025-01-17T11:00:00", crmSync: "synced" },
];

// ==========================================
// ACTIVITY FEED
// ==========================================
export const activityFeed: ActivityItem[] = [
  { id: 1, message: "Maria booked service appointment for John D. at 2:15 PM", timestamp: "2 min ago", type: "appointment" },
  { id: 2, message: "Talking Postcard scanned by Sarah M. \u2014 conversation started", timestamp: "8 min ago", type: "scan" },
  { id: 3, message: "Call transferred to service dept \u2014 customer requested human", timestamp: "15 min ago", type: "transfer" },
  { id: 4, message: "Maria booked test drive for Marcus W. at 10:49 PM (after hours)", timestamp: "22 min ago", type: "appointment" },
  { id: 5, message: "Outbound call to Thomas M. \u2014 buyback offer accepted", timestamp: "34 min ago", type: "appointment" },
  { id: 6, message: "Maria booked brake service for Nathan S.", timestamp: "41 min ago", type: "appointment" },
  { id: 7, message: "Talking Postcard scanned by Linda P. \u2014 appraisal booked", timestamp: "55 min ago", type: "scan" },
  { id: 8, message: "After-hours call from Sofia H. \u2014 appraisal appointment set", timestamp: "1h ago", type: "appointment" },
  { id: 9, message: "Maria handled recall inquiry for Patricia C.", timestamp: "1h 15m ago", type: "call" },
  { id: 10, message: "Outbound campaign call \u2014 Paul A. scheduled for buyback", timestamp: "1h 30m ago", type: "appointment" },
];

// ==========================================
// OVERVIEW STATS
// ==========================================
export const overviewStats = {
  totalCallsToday: 47,
  callsDelta: "+18%",
  callsDeltaPositive: true,
  appointmentsBooked: 32,
  appointmentsDelta: "+24%",
  appointmentsDeltaPositive: true,
  conversionRate: 68,
  showRate: 78,
  showRateDelta: "+5%",
  showRateDeltaPositive: true,
  avgResponseTime: 0.8, // seconds
  responseDelta: "-92%",
  responseDeltaPositive: true, // lower is better
  revenueImpact: 8512, // 32 appointments × $266 avg gross
  revenueDelta: "+24%",
  revenueDeltaPositive: true,
  aiCost: 1.23, // 47 calls × avg 2.5 min × $0.011/min
  costDelta: "+18%",
  costDeltaPositive: false, // higher cost = not positive direction, but negligible
  costPerAppointment: 0.04,
};

// ==========================================
// CAMPAIGN PERFORMANCE SUMMARY
// ==========================================
export const campaignSummary = campaigns.filter(c => c.status !== "draft").map(c => ({
  name: c.name,
  piecesMailed: c.piecesMailed,
  qrScans: c.qrScans,
  conversations: c.conversationsStarted,
  appointments: c.appointmentsBooked,
  conversionRate: ((c.appointmentsBooked / c.qrScans) * 100).toFixed(1),
}));
