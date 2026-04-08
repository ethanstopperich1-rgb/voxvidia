import { useState } from "react";
import { Bot, Plug, Bell, Building2, Check, AlertCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

const integrations = [
  { name: "Deepgram", description: "Nova-3 ASR Speech-to-Text", status: "connected", key: "dg_****_3kf9" },
  { name: "OpenAI", description: "GPT-4.1 mini Language Model", status: "connected", key: "sk-****_x8m2" },
  { name: "Rime", description: "Mist v3 Text-to-Speech", status: "connected", key: "rm_****_7nq4" },
  { name: "Twilio", description: "Phone number + SIP trunk", status: "connected", key: "AC_****_2pb6" },
  { name: "Tavus", description: "CVI Video AI Agent", status: "connected", key: "tv_****_5jh1" },
  { name: "DealerSocket CRM", description: "ADF/XML lead delivery", status: "warning", key: "Webhook configured" },
];

export default function Settings() {
  const [agentName, setAgentName] = useState("Maria");
  const [companyName, setCompanyName] = useState("Orlando Motors");
  const [systemPrompt, setSystemPrompt] = useState(
    `You are Maria, a friendly and professional virtual assistant for Orlando Motors, a premier automotive dealership in Orlando, Florida. Your primary goals are:

1. Answer incoming calls professionally and warmly
2. Help customers schedule service appointments, test drives, and appraisals
3. Provide information about vehicle inventory, service offerings, and dealership hours
4. Collect customer information (name, phone, vehicle) for appointment booking
5. Transfer to a human agent when requested or when the situation requires it

Always maintain a helpful, patient tone. Never pressure customers. Confirm all appointment details before booking.`
  );

  return (
    <div className="p-6 space-y-8 overflow-auto h-full max-w-4xl" data-testid="page-settings">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Agent configuration and integrations</p>
      </div>

      {/* Agent Configuration */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Bot className="h-4 w-4 text-[#d4a843]" />
          <h2 className="text-sm font-semibold text-foreground">Agent Configuration</h2>
        </div>
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Agent Name</label>
              <Input
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className="bg-[#0a0a0a] border-[#1e1e1e] text-sm"
                data-testid="input-agent-name"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Company Name</label>
              <Input
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="bg-[#0a0a0a] border-[#1e1e1e] text-sm"
                data-testid="input-company-name"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Voice</label>
            <div className="flex items-center gap-3">
              {["Mist v3 (Female)", "Mist v3 (Male)", "Custom Clone"].map((voice, i) => (
                <button
                  key={voice}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    i === 0
                      ? "bg-[#d4a843]/10 text-[#d4a843] border-[#d4a843]/30"
                      : "bg-[#161616] text-muted-foreground border-[#1e1e1e] hover:border-[#2a2a2a]"
                  }`}
                >
                  {voice}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">System Prompt</label>
            <Textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="bg-[#0a0a0a] border-[#1e1e1e] text-xs font-mono leading-relaxed min-h-[180px] resize-y"
              data-testid="textarea-system-prompt"
            />
          </div>
        </div>
      </section>

      {/* Integrations */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Plug className="h-4 w-4 text-[#d4a843]" />
          <h2 className="text-sm font-semibold text-foreground">Integrations</h2>
        </div>
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] divide-y divide-[#1a1a1a]">
          {integrations.map((integration) => (
            <div key={integration.name} className="p-4 flex items-center justify-between" data-testid={`integration-${integration.name.toLowerCase()}`}>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-foreground">{integration.name}</h3>
                  {integration.status === "connected" ? (
                    <Badge variant="outline" className="text-[10px] bg-emerald-400/10 text-emerald-400 border-emerald-400/20">
                      <Check className="h-2.5 w-2.5 mr-1" /> Connected
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] bg-[#d4a843]/10 text-[#d4a843] border-[#d4a843]/20">
                      <AlertCircle className="h-2.5 w-2.5 mr-1" /> Check Config
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{integration.description}</p>
              </div>
              <span className="text-[11px] text-muted-foreground/50 font-mono">{integration.key}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Notifications */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Bell className="h-4 w-4 text-[#d4a843]" />
          <h2 className="text-sm font-semibold text-foreground">Notifications</h2>
        </div>
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-5 space-y-4">
          {[
            { label: "Slack alerts for call transfers", description: "Notify when AI transfers to human", defaultOn: true },
            { label: "Email alerts for system failures", description: "API errors, timeouts, service outages", defaultOn: true },
            { label: "Daily summary email", description: "KPIs and performance digest at 8 AM", defaultOn: false },
            { label: "New appointment notifications", description: "Real-time alerts for booked appointments", defaultOn: true },
          ].map((item) => (
            <div key={item.label} className="flex items-center justify-between">
              <div>
                <p className="text-xs text-foreground">{item.label}</p>
                <p className="text-[11px] text-muted-foreground">{item.description}</p>
              </div>
              <Switch defaultChecked={item.defaultOn} data-testid={`switch-${item.label.toLowerCase().replace(/\s+/g, "-")}`} />
            </div>
          ))}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Slack Webhook URL</label>
            <Input
              placeholder="https://hooks.slack.com/services/..."
              className="bg-[#0a0a0a] border-[#1e1e1e] text-xs font-mono"
              data-testid="input-slack-webhook"
            />
          </div>
        </div>
      </section>

      {/* Dealer Profile */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="h-4 w-4 text-[#d4a843]" />
          <h2 className="text-sm font-semibold text-foreground">Dealer Profile</h2>
        </div>
        <div className="rounded-lg border border-[#1e1e1e] bg-[#111] p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Dealership Name</label>
              <Input value="Orlando Motors" className="bg-[#0a0a0a] border-[#1e1e1e] text-sm" readOnly data-testid="input-dealership-name" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Phone</label>
              <Input value="(407) 555-1000" className="bg-[#0a0a0a] border-[#1e1e1e] text-sm" readOnly data-testid="input-dealership-phone" />
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Address</label>
            <Input value="7820 International Drive, Orlando, FL 32819" className="bg-[#0a0a0a] border-[#1e1e1e] text-sm" readOnly data-testid="input-dealership-address" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Hours of Operation</label>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="flex justify-between bg-[#0a0a0a] rounded px-3 py-2">
                <span>Mon-Fri</span>
                <span className="text-foreground">7:00 AM — 6:00 PM</span>
              </div>
              <div className="flex justify-between bg-[#0a0a0a] rounded px-3 py-2">
                <span>Saturday</span>
                <span className="text-foreground">8:00 AM — 5:00 PM</span>
              </div>
              <div className="flex justify-between bg-[#0a0a0a] rounded px-3 py-2">
                <span>Sunday</span>
                <span className="text-foreground">Closed</span>
              </div>
              <div className="flex justify-between bg-[#0a0a0a] rounded px-3 py-2">
                <span>AI Agent</span>
                <span className="text-[#d4a843]">24/7/365</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
