import type { SvgIconComponent } from "@mui/icons-material";
import RouterOutlined from "@mui/icons-material/RouterOutlined";
import DesktopWindowsOutlined from "@mui/icons-material/DesktopWindowsOutlined";
import MemoryOutlined from "@mui/icons-material/MemoryOutlined";
import LaptopMacOutlined from "@mui/icons-material/LaptopMacOutlined";
import PrintOutlined from "@mui/icons-material/PrintOutlined";
import VideocamOutlined from "@mui/icons-material/VideocamOutlined";
import LanguageOutlined from "@mui/icons-material/LanguageOutlined";
import HelpOutlineOutlined from "@mui/icons-material/HelpOutlineOutlined";
import type { Category } from "./net";

// Device-type colors, in ring order. Validated with the dataviz palette
// checker (adjacent pairs, since the topology places categories as neighboring
// clusters in exactly this order): CVD ΔE >= 8.4, normal-vision ΔE >= 19.3.
// "Unidentified" is deliberately low-chroma and sits between web appliances
// and network gear, which also separates the one close pair (violet/blue).
// Light-scheme fills under 3:1 on the page are relieved by visible labels,
// icons and the Devices table, never color alone.
export const CATEGORY_COLORS: Record<"light" | "dark", Record<Category, string>> = {
  light: {
    "firewall/network": "#2a78d6",
    "windows/smb": "#eb6834",
    "linux/iot": "#1baf7a",
    apple: "#eda100",
    printer: "#e87ba4",
    "camera/media": "#008300",
    "web appliance": "#4a3aa7",
    unknown: "#8a94a3",
  },
  dark: {
    "firewall/network": "#3987e5",
    "windows/smb": "#d95926",
    "linux/iot": "#199e70",
    apple: "#c98500",
    printer: "#d55181",
    "camera/media": "#008300",
    "web appliance": "#9085e9",
    unknown: "#64748b",
  },
};

export const CATEGORY_ICON: Record<Category, SvgIconComponent> = {
  "firewall/network": RouterOutlined,
  "windows/smb": DesktopWindowsOutlined,
  "linux/iot": MemoryOutlined,
  apple: LaptopMacOutlined,
  printer: PrintOutlined,
  "camera/media": VideocamOutlined,
  "web appliance": LanguageOutlined,
  unknown: HelpOutlineOutlined,
};
