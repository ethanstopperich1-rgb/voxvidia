import { useLocation, Link } from "wouter";
import {
  LayoutDashboard,
  Phone,
  Mail,
  CalendarCheck,
  FileText,
  Settings,
  Building2,
  ChevronDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Overview", url: "/", icon: LayoutDashboard },
  { title: "Voice Calls", url: "/voice-calls", icon: Phone },
  { title: "Campaigns", url: "/campaigns", icon: Mail },
  { title: "Appointments", url: "/appointments", icon: CalendarCheck },
  { title: "Transcripts", url: "/transcripts", icon: FileText },
  { title: "Settings", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar data-testid="sidebar">
      <SidebarHeader className="p-5 pb-6">
        <Link href="/" className="flex items-center gap-2 no-underline">
          <VoxarisLogo />
          <span className="text-base font-semibold tracking-wide text-foreground">
            VOXARIS
          </span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive =
                  item.url === "/"
                    ? location === "/"
                    : location.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      className={`relative h-10 rounded-md transition-all duration-150 ${
                        isActive
                          ? "bg-[#1a1a1a] text-[#d4a843]"
                          : "text-[#888] hover:text-foreground hover:bg-[#161616]"
                      }`}
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-[#d4a843]" />
                        )}
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="text-sm font-medium">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="flex items-center gap-3 rounded-md border border-[#1e1e1e] bg-[#111] p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[#1a1a1a]">
            <Building2 className="h-4 w-4 text-[#d4a843]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground truncate">Orlando Motors</p>
            <p className="text-[11px] text-muted-foreground truncate">Orlando, FL</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

function VoxarisLogo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-label="Voxaris logo"
      className="shrink-0"
    >
      <rect width="28" height="28" rx="6" fill="#161616" />
      <path
        d="M7 8L14 20L21 8"
        stroke="#d4a843"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="14" cy="20" r="2" fill="#d4a843" />
    </svg>
  );
}
