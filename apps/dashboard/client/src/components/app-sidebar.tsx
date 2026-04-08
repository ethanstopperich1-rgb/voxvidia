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
import logoSrc from "@assets/logo.jpg";

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
      <SidebarHeader className="p-5 pb-8">
        <Link href="/" className="block no-underline">
          <img src={logoSrc} alt="Voxaris AI" className="w-full max-w-[180px] h-auto" />
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
                          ? "bg-gray-100 text-gray-900 font-medium"
                          : "text-gray-500 hover:text-gray-900 hover:bg-gray-50"
                      }`}
                    >
                      <Link href={item.url} data-testid={`nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r-full bg-gray-900" />
                        )}
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="text-sm">{item.title}</span>
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
        <div className="flex items-center gap-3 rounded-md border border-gray-200 bg-white p-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100">
            <Building2 className="h-4 w-4 text-gray-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-900 truncate">Orlando Motors</p>
            <p className="text-[11px] text-gray-500 truncate">Orlando, FL</p>
          </div>
          <ChevronDown className="h-3.5 w-3.5 text-gray-400 shrink-0" />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
